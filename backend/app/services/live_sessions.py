import asyncio
import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from ..models import BehaviorEvent, StudentRef


@dataclass
class LiveSessionState:
    session_id: str
    provider: str
    interval_seconds: float
    status: str = "ready"
    sample_count: int = 0
    sequence: int = 0
    events: Dict[str, BehaviorEvent] = field(default_factory=dict)
    known_students: Dict[str, StudentRef] = field(default_factory=dict)
    active_by_student: Dict[str, str] = field(default_factory=dict)
    last_seen: Dict[str, float] = field(default_factory=dict)
    last_seen_sample: Dict[str, int] = field(default_factory=dict)
    latest_summary: str = ""
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def known_student_context(self) -> List[dict]:
        return [student.model_dump(mode="json") for student in self.known_students.values()]

    @staticmethod
    def _center(student: StudentRef) -> Tuple[float, float]:
        return (
            student.rect.x + student.rect.width / 2,
            student.rect.y + student.rect.height / 2,
        )

    def _stable_student(self, candidate: StudentRef, used_ids: set) -> StudentRef:
        if candidate.id in self.known_students and candidate.id not in used_ids:
            previous = self.known_students[candidate.id]
            stable = candidate.model_copy(update={"label": previous.label})
            self.known_students[candidate.id] = stable
            return stable

        cx, cy = self._center(candidate)
        nearest_id: Optional[str] = None
        nearest_distance = math.inf
        for student_id, previous in self.known_students.items():
            if student_id in used_ids:
                continue
            px, py = self._center(previous)
            distance = math.hypot(cx - px, cy - py)
            if distance < nearest_distance:
                nearest_id = student_id
                nearest_distance = distance
        if nearest_id is not None and nearest_distance <= 0.18:
            previous = self.known_students[nearest_id]
            stable = candidate.model_copy(update={"id": nearest_id, "label": previous.label})
            self.known_students[nearest_id] = stable
            return stable

        base_id = candidate.id or f"seat-{len(self.known_students) + 1}"
        stable_id = base_id
        suffix = 2
        while stable_id in self.known_students or stable_id in used_ids:
            stable_id = f"{base_id}-{suffix}"
            suffix += 1
        stable = candidate.model_copy(update={"id": stable_id})
        self.known_students[stable_id] = stable
        return stable

    def record_frame(
        self,
        raw_events: List[BehaviorEvent],
        elapsed: float,
        summary: str,
    ) -> List[BehaviorEvent]:
        """稳定座位编号，并把连续相同行为合并为一个课堂事件。"""
        self.sample_count += 1
        self.status = "monitoring"
        self.latest_summary = summary
        used_ids: set = set()
        candidates: Dict[str, Tuple[BehaviorEvent, StudentRef]] = {}
        severity_order = {"info": 0, "warning": 1, "alert": 2}

        for event in raw_events:
            for student in event.students:
                stable = self._stable_student(student, used_ids)
                used_ids.add(stable.id)
                previous = candidates.get(stable.id)
                if previous and severity_order[previous[0].severity] > severity_order[event.severity]:
                    continue
                candidates[stable.id] = (event, stable)

        for student_id, last_sample in list(self.last_seen_sample.items()):
            if self.sample_count - last_sample > 2:
                self.active_by_student.pop(student_id, None)

        current: List[BehaviorEvent] = []
        for student_id, (raw_event, student) in candidates.items():
            previous_id = self.active_by_student.get(student_id)
            previous = self.events.get(previous_id) if previous_id else None
            continuous = bool(
                previous
                and previous.behavior == raw_event.behavior
                and previous.severity == raw_event.severity
                and self.sample_count - self.last_seen_sample.get(student_id, self.sample_count) <= 2
            )
            if continuous and previous:
                duration = max(previous.duration, elapsed - previous.time + self.interval_seconds)
                updated = previous.model_copy(
                    update={
                        "duration": round(duration, 1),
                        "students": [student],
                    }
                )
                self.events[previous.id] = updated
                current.append(updated)
            else:
                self.sequence += 1
                event_id = f"live-event-{self.sequence:04d}"
                created = raw_event.model_copy(
                    update={
                        "id": event_id,
                        "time": round(elapsed, 1),
                        "duration": round(self.interval_seconds, 1),
                        "students": [student],
                        "speech": raw_event.speech if raw_event.severity != "info" else "",
                    }
                )
                self.events[event_id] = created
                self.active_by_student[student_id] = event_id
                current.append(created)
            self.last_seen[student_id] = elapsed
            self.last_seen_sample[student_id] = self.sample_count

        return sorted(current, key=lambda item: (severity_order[item.severity], item.students[0].id))

    def all_events(self) -> List[BehaviorEvent]:
        return sorted(self.events.values(), key=lambda item: (item.time, item.id))

    def classroom_summary(self) -> str:
        alerts = [event for event in self.events.values() if event.severity != "info"]
        if not self.events:
            return "本次课堂监督未获得可用的学生行为分析结果。"
        if not alerts:
            return self.latest_summary or "本次监督期间未发现需要语音提醒的课堂行为。"
        behaviors = "、".join(sorted({event.behavior for event in alerts}))
        return (
            f"本次课堂监督共完成 {self.sample_count} 次画面分析，"
            f"记录到{behaviors}等需要关注的行为，数字教师已在相应时刻进行语音提醒。"
        )
