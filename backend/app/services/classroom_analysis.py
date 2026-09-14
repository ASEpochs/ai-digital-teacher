import json
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import httpx
from pydantic import TypeAdapter, ValidationError

from ..models import BehaviorEvent


SYSTEM_PROMPT = """你是一名谨慎、客观、专业的数字教师。你负责完整观看学生自习视频，识别画面中每一名清晰可见学生的座位位置和课堂状态。
只依据画面作判断，不做人脸识别，不猜测姓名、身份、性格、情绪、健康状况或行为动机。学生用座位位置命名，例如“第一排第二位”。
座位编号按画面透视统一确定：从画面下方向上方依次编号为第一排、第二排；同一排从画面左侧向右侧依次编号。若画面透视不足以可靠判断排数，可使用“画面左侧学生”“画面中间学生”等明确位置描述，不得虚构身份。
同一座位在不同事件中必须使用相同 student id。学生位置使用相对于视频画面的归一化坐标，x、y、width、height 均在 0 到 1 之间。
位置框应尽量贴合学生身体可见范围，不能框住桌面、墙面或无关人员。既要记录值得提醒的异常行为，也要记录认真书写、阅读资料、专注听讲或持续完成学习任务等明确可见的正向状态。
忽略短暂且正常的低头书写、翻书和调整坐姿，不得把正常学习误判为违规。输出必须是一个 JSON 对象，不要输出 Markdown 或额外解释。"""


@dataclass
class ClassroomAnalysisResult:
    events: List[BehaviorEvent]
    classroom_summary: str


class ClassroomAnalysisProvider(ABC):
    name = "base"

    @abstractmethod
    async def analyze(self, video_url: str, duration: float) -> ClassroomAnalysisResult:
        raise NotImplementedError


class JsonTimelineAnalysisProvider(ClassroomAnalysisProvider):
    name = "json-fallback"

    def __init__(self, events: List[BehaviorEvent]):
        self.events = events

    async def analyze(self, video_url: str, duration: float) -> ClassroomAnalysisResult:
        usable = [event for event in self.events if event.time <= duration]
        return ClassroomAnalysisResult(
            events=usable,
            classroom_summary="课堂行为分析使用本地时间轴生成；配置豆包视觉模型后可根据视频动态分析。",
        )


class DoubaoVideoAnalysisProvider(ClassroomAnalysisProvider):
    name = "doubao-video-understanding"

    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        fps: float = 1.0,
        max_output_tokens: int = 8000,
        timeout_seconds: int = 1200,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.fps = max(0.2, min(5.0, fps))
        self.max_output_tokens = max_output_tokens
        self.timeout_seconds = timeout_seconds

    @staticmethod
    def _extract_output_text(payload: Dict[str, Any]) -> str:
        direct = payload.get("output_text")
        if isinstance(direct, str) and direct.strip():
            return direct
        pieces: List[str] = []
        for item in payload.get("output", []):
            if not isinstance(item, dict):
                continue
            for content in item.get("content", []):
                if not isinstance(content, dict):
                    continue
                if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                    pieces.append(content["text"])
        if not pieces:
            raise RuntimeError("豆包视频理解响应中没有文本结果")
        return "\n".join(pieces)

    @staticmethod
    def _parse_json(text: str) -> Dict[str, Any]:
        cleaned = text.strip()
        fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", cleaned, re.DOTALL | re.IGNORECASE)
        if fence:
            cleaned = fence.group(1)
        try:
            value = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            start, end = cleaned.find("{"), cleaned.rfind("}")
            if start < 0 or end <= start:
                raise RuntimeError("豆包没有返回可解析的课堂行为 JSON") from exc
            try:
                value = json.loads(cleaned[start : end + 1])
            except json.JSONDecodeError as nested:
                raise RuntimeError("豆包返回的课堂行为 JSON 格式错误") from nested
        if not isinstance(value, dict):
            raise RuntimeError("豆包课堂分析结果必须是 JSON 对象")
        return value

    @staticmethod
    def _normalized_events(raw_events: Any, duration: float) -> List[BehaviorEvent]:
        if not isinstance(raw_events, list):
            raise RuntimeError("豆包课堂分析结果缺少 events 数组")
        normalized: List[Dict[str, Any]] = []
        used_ids = set()
        for index, raw in enumerate(raw_events):
            if not isinstance(raw, dict):
                continue
            try:
                event_time = max(0.0, float(raw.get("time", 0)))
                event_duration = max(1.0, float(raw.get("duration", 1)))
            except (TypeError, ValueError):
                continue
            if event_time > duration:
                continue
            event_duration = min(event_duration, max(1.0, duration - event_time))
            event_id = str(raw.get("id") or f"ai-event-{index + 1:03d}")
            if event_id in used_ids:
                event_id = f"ai-event-{index + 1:03d}"
            used_ids.add(event_id)
            students = []
            for student_index, student in enumerate(raw.get("students", [])):
                if not isinstance(student, dict) or not isinstance(student.get("rect"), dict):
                    continue
                rect = student["rect"]
                try:
                    x = max(0.0, min(0.98, float(rect.get("x", 0))))
                    y = max(0.0, min(0.98, float(rect.get("y", 0))))
                    width = max(0.02, min(1.0 - x, float(rect.get("width", 0.1))))
                    height = max(0.02, min(1.0 - y, float(rect.get("height", 0.2))))
                except (TypeError, ValueError):
                    continue
                label = str(student.get("label") or f"画面中学生{student_index + 1}")
                students.append(
                    {
                        "id": str(student.get("id") or f"seat-{index + 1}-{student_index + 1}"),
                        "label": label,
                        "rect": {"x": x, "y": y, "width": width, "height": height},
                    }
                )
            if not students:
                continue
            severity = raw.get("severity", "warning")
            if severity not in {"info", "warning", "alert"}:
                severity = "warning"
            behavior = str(raw.get("behavior") or "需要关注的课堂行为").strip()
            if severity == "info":
                speech = str(raw.get("speech") or "").strip()
            else:
                speech = str(raw.get("speech") or f"{students[0]['label']}同学，请集中注意力。").strip()
            normalized.append(
                {
                    "id": event_id,
                    "time": round(event_time, 1),
                    "duration": round(event_duration, 1),
                    "students": students,
                    "behavior": behavior[:80],
                    "speech": speech[:300],
                    "severity": severity,
                }
            )
        try:
            events = TypeAdapter(List[BehaviorEvent]).validate_python(normalized)
        except ValidationError as exc:
            raise RuntimeError(f"豆包课堂事件结构校验失败：{exc}") from exc
        return sorted(events, key=lambda item: item.time)

    async def _request(self, payload: Dict[str, Any], failure_label: str) -> Dict[str, Any]:
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds, follow_redirects=True) as client:
                response = await client.post(f"{self.base_url}/responses", headers=headers, json=payload)
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:500]
            raise RuntimeError(f"{failure_label} HTTP {exc.response.status_code}：{detail}") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise RuntimeError(f"{failure_label}请求失败：{exc}") from exc

    async def analyze_frame(
        self,
        image_url: str,
        elapsed: float,
        known_students: List[Dict[str, Any]],
        interval_seconds: float,
    ) -> ClassroomAnalysisResult:
        known_context = json.dumps(known_students, ensure_ascii=False) if known_students else "[]"
        prompt = f"""这是课堂摄像头在监督开始后第 {elapsed:.1f} 秒采集的当前画面。请识别每一名清晰可见的学生，并返回当前可见行为。

这是此前建立的座位表：{known_context}
若当前学生与座位表中位置相近，必须沿用已有 id 和 label；只有确认出现新座位时才能创建新 id。首次识别时，按画面中从前到后、同排从左到右建立 r1-s1、r1-s2 等稳定编号。

请特别区分正常低头书写与分心行为。专注听讲、阅读、书写使用 severity="info" 且 speech=""；交头接耳、玩手机、趴桌睡觉、打闹、明显持续回头等需要提醒的行为使用 severity="warning" 或 "alert"，并给出一句简短、明确的中文教师提醒。多人共同交谈可以放在同一事件中。
每名清晰可见学生必须且只能出现在一个代表其当前主要状态的事件中。位置框必须使用相对于整张画面的 0 到 1 归一化坐标，并尽量贴合学生身体。

只返回 JSON：
{{
  "classroom_summary": "对当前课堂画面的简短客观说明",
  "events": [
    {{
      "id": "frame-event-001",
      "time": {elapsed:.1f},
      "duration": {interval_seconds:.1f},
      "students": [{{"id": "r1-s1", "label": "第一排第一位", "rect": {{"x": 0.1, "y": 0.2, "width": 0.15, "height": 0.35}}}}],
      "behavior": "专注学习",
      "speech": "",
      "severity": "info"
    }}
  ]
}}"""
        payload = {
            "model": self.model,
            "instructions": SYSTEM_PROMPT,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_image", "image_url": image_url},
                        {"type": "input_text", "text": prompt},
                    ],
                }
            ],
            "temperature": 0.1,
            "max_output_tokens": self.max_output_tokens,
        }
        data = await self._request(payload, "豆包摄像头画面理解")
        parsed = self._parse_json(self._extract_output_text(data))
        events = self._normalized_events(parsed.get("events"), elapsed + interval_seconds)
        events = [event.model_copy(update={"time": round(elapsed, 1), "duration": round(interval_seconds, 1)}) for event in events]
        summary = str(parsed.get("classroom_summary") or "当前课堂画面已完成分析。")[:1000]
        return ClassroomAnalysisResult(events=events, classroom_summary=summary)

    async def analyze(self, video_url: str, duration: float) -> ClassroomAnalysisResult:
        prompt = f"""请从头到尾完整分析这段时长约 {duration:.1f} 秒的学生自习视频，并尽可能具体地建立课堂行为记录。

第一步，定位画面中每一名清晰可见的学生。对每名学生使用稳定、具体的座位标签和 student id，并提供贴合学生身体的归一化位置框。

第二步，同时记录两类课堂状态：
1. 正向课堂观察：认真书写、阅读资料、专注听讲、持续完成学习任务等。每一名清晰可见且保持正常学习的学生，至少生成一条独立事件；behavior 使用“专注学习”“认真书写”“阅读资料”等具体名称，severity 必须为 "info"，speech 必须为空字符串。开始时间和持续时间应覆盖能够确认该状态的代表性连续片段。
2. 行为提醒：使用手机、交头接耳、离座、趴桌或睡觉、打闹、长时间与学习无关地回头，以及明显持续分心。只有持续到值得提醒时才记录，severity 使用 "warning" 或 "alert"，并生成简洁、自然的教师中文提醒语。

短暂低头书写、看书、翻页和调整坐姿属于正常学习，不得记录为违规。无法确认的行为不要猜测。多人参与同一异常行为时可以放在同一事件；正向课堂观察应按学生分别生成，便于逐人展示位置和状态。
对每个事件给出开始时间 time（秒）、持续时间 duration（秒）、涉及学生的具体座位标签和位置框、简洁行为名称、教师中文提醒语及严重程度。
返回格式：
{{
  "classroom_summary": "说明可见学生数量、各自主要状态、异常行为及整体课堂情况的客观完整总结",
  "events": [
    {{
      "id": "ai-event-001",
      "time": 12.5,
      "duration": 8,
      "students": [{{"id": "r1-s2", "label": "第一排第二位", "rect": {{"x": 0.1, "y": 0.2, "width": 0.12, "height": 0.25}}}}],
      "behavior": "使用手机",
      "speech": "第一排第二位同学，请收起手机，专注学习。",
      "severity": "warning"
    }},
    {{
      "id": "ai-observation-001",
      "time": 1,
      "duration": 20,
      "students": [{{"id": "r1-s1", "label": "第一排第一位", "rect": {{"x": 0.35, "y": 0.35, "width": 0.18, "height": 0.35}}}}],
      "behavior": "专注学习",
      "speech": "",
      "severity": "info"
    }}
  ]
}}
即使没有任何违规或需要提醒的行为，events 也不能返回空数组；必须为每一名清晰可见的学生生成正向课堂观察事件，并在 classroom_summary 中逐一说明其学习状态。"""
        payload = {
            "model": self.model,
            "instructions": SYSTEM_PROMPT,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_video", "video_url": video_url, "fps": self.fps},
                        {"type": "input_text", "text": prompt},
                    ],
                }
            ],
            "temperature": 0.1,
            "max_output_tokens": self.max_output_tokens,
        }
        data = await self._request(payload, "豆包视频理解")
        parsed = self._parse_json(self._extract_output_text(data))
        events = self._normalized_events(parsed.get("events"), duration)
        summary = str(parsed.get("classroom_summary") or "本次课堂视频已完成智能分析。")[:1000]
        return ClassroomAnalysisResult(events=events, classroom_summary=summary)
