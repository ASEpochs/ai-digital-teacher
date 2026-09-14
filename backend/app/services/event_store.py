import json
from pathlib import Path
from typing import List

from pydantic import TypeAdapter, ValidationError

from ..models import BehaviorEvent


class EventDataError(RuntimeError):
    pass


class JsonEventStore:
    def __init__(self, path: Path):
        self.path = path

    def load(self) -> List[BehaviorEvent]:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            events = TypeAdapter(List[BehaviorEvent]).validate_python(raw)
        except FileNotFoundError as exc:
            raise EventDataError("行为时间轴文件不存在") from exc
        except (json.JSONDecodeError, ValidationError) as exc:
            raise EventDataError(f"行为时间轴格式错误：{exc}") from exc
        ids = [event.id for event in events]
        if len(ids) != len(set(ids)):
            raise EventDataError("行为时间轴中存在重复事件 ID")
        for event in events:
            for student in event.students:
                if student.rect.x + student.rect.width > 1 or student.rect.y + student.rect.height > 1:
                    raise EventDataError(f"事件 {event.id} 的学生坐标超出视频范围")
        return sorted(events, key=lambda item: item.time)

