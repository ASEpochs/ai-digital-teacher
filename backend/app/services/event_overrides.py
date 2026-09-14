import json
from pathlib import Path
from typing import List, Literal, Optional, Tuple

from pydantic import BaseModel, Field

from ..models import BehaviorEvent, StudentRef


class BehaviorOverride(BaseModel):
    id: str
    time: float = Field(ge=0)
    duration: float = Field(gt=0)
    student_ids: List[str] = Field(min_length=1)
    behavior: str
    speech: str
    severity: Literal["warning", "alert"] = "warning"


class EventOverrideConfig(BaseModel):
    enabled: bool = True
    events: List[BehaviorOverride] = Field(default_factory=list)
    classroom_summary: Optional[str] = None


def load_event_overrides(path: Path) -> EventOverrideConfig:
    try:
        return EventOverrideConfig.model_validate_json(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, ValueError):
        return EventOverrideConfig(enabled=False)


def _copy_event(
    event: BehaviorEvent,
    event_id: str,
    students: List[StudentRef],
    time: float,
    duration: float,
) -> BehaviorEvent:
    return event.model_copy(
        update={
            "id": event_id,
            "students": students,
            "time": round(time, 3),
            "duration": round(duration, 3),
        }
    )


def apply_event_overrides(
    events: List[BehaviorEvent],
    config: EventOverrideConfig,
    video_duration: float,
) -> Tuple[List[BehaviorEvent], bool]:
    if not config.enabled or not config.events:
        return events, False

    result = list(events)
    applied = False
    student_lookup = {
        student.id: student
        for event in events
        for student in event.students
    }

    for override in config.events:
        if any(event.id == override.id for event in result):
            applied = True
            continue
        if override.time >= video_duration:
            continue
        if any(student_id not in student_lookup for student_id in override.student_ids):
            continue

        end = min(video_duration, override.time + override.duration)
        affected_ids = set(override.student_ids)
        next_events: List[BehaviorEvent] = []

        for event in result:
            event_end = event.time + event.duration
            affected = [student for student in event.students if student.id in affected_ids]
            overlaps = event.time < end and event_end > override.time
            if event.severity != "info" or not affected or not overlaps:
                next_events.append(event)
                continue

            unaffected = [student for student in event.students if student.id not in affected_ids]
            if unaffected:
                next_events.append(
                    _copy_event(event, f"{event.id}-unaffected-{override.id}", unaffected, event.time, event.duration)
                )

            before_duration = min(event_end, override.time) - event.time
            if before_duration > 0.01:
                next_events.append(
                    _copy_event(event, f"{event.id}-before-{override.id}", affected, event.time, before_duration)
                )

            after_time = max(event.time, end + 0.01)
            after_duration = event_end - after_time
            if after_duration > 0.01:
                next_events.append(
                    _copy_event(event, f"{event.id}-after-{override.id}", affected, after_time, after_duration)
                )

        next_events.append(
            BehaviorEvent(
                id=override.id,
                time=override.time,
                duration=end - override.time,
                students=[student_lookup[student_id] for student_id in override.student_ids],
                behavior=override.behavior,
                speech=override.speech,
                severity=override.severity,
            )
        )
        result = next_events
        applied = True

    severity_order = {"info": 0, "warning": 1, "alert": 2}
    result.sort(key=lambda event: (event.time, severity_order[event.severity], event.id))
    return result, applied
