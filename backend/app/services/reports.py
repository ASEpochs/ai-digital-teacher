from collections import defaultdict
from typing import Dict, Iterable, List, Set

from ..models import (
    BehaviorEvent,
    BehaviorStat,
    ClassroomReport,
    StudentReport,
    StudentTimelineItem,
)


class ReportProvider:
    name = "base"

    def generate(self, events: Iterable[BehaviorEvent], triggered_ids: Set[str]) -> ClassroomReport:
        raise NotImplementedError


class LocalRuleReportProvider(ReportProvider):
    name = "local-rules"

    def generate(self, events: Iterable[BehaviorEvent], triggered_ids: Set[str]) -> ClassroomReport:
        students: Dict[str, dict] = {}
        used_events = [event for event in events if event.id in triggered_ids]
        for event in used_events:
            for student in event.students:
                row = students.setdefault(
                    student.id,
                    {"label": student.label, "behaviors": defaultdict(lambda: [0, 0.0]), "timeline": []},
                )
                row["behaviors"][event.behavior][0] += 1
                row["behaviors"][event.behavior][1] += event.duration
                row["timeline"].append(
                    StudentTimelineItem(
                        event_id=event.id,
                        time=event.time,
                        duration=event.duration,
                        behavior=event.behavior,
                        severity=event.severity,
                    )
                )
        reports: List[StudentReport] = []
        for student_id, row in students.items():
            behaviors = {
                name: BehaviorStat(count=value[0], duration=round(value[1], 1))
                for name, value in row["behaviors"].items()
            }
            reminder_count = sum(1 for item in row["timeline"] if item.severity != "info")
            positive_phrases = [
                f"{name}{stat.count}次"
                for name, stat in behaviors.items()
                if any(item.behavior == name and item.severity == "info" for item in row["timeline"])
            ]
            attention_phrases = [
                f"{name}{stat.count}次"
                for name, stat in behaviors.items()
                if any(item.behavior == name and item.severity != "info" for item in row["timeline"])
            ]
            if attention_phrases:
                summary = "本次自习过程中记录到" + "、".join(attention_phrases) + "，已在相应时刻进行语音提醒。"
                if positive_phrases:
                    summary += "其他时段可见" + "、".join(positive_phrases) + "。"
            else:
                summary = "本次学习过程中一直保持专注学习。无其他分心行为。"
            reports.append(
                StudentReport(
                    student_id=student_id,
                    label=row["label"],
                    behaviors=behaviors,
                    reminder_count=reminder_count,
                    timeline=sorted(row["timeline"], key=lambda item: item.time),
                    summary=summary,
                )
            )
        return ClassroomReport(
            generated_by=self.name,
            students=sorted(reports, key=lambda item: item.student_id),
            total_events=len(used_events),
        )


class LLMReportProvider(ReportProvider):
    """后续豆包/千问润色扩展点；必须以 LocalRuleReportProvider 的结构化结果为输入。"""

    name = "llm-placeholder"

    def generate(self, events: Iterable[BehaviorEvent], triggered_ids: Set[str]) -> ClassroomReport:
        raise NotImplementedError("第一版不依赖大模型生成报告")
