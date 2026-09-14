import asyncio

import pytest

from backend.app.models import BehaviorEvent
from backend.app.services.event_store import EventDataError, JsonEventStore
from backend.app.services.digital_human import (
    DigitalHumanProvider,
    DigitalHumanResult,
    VolcengineOmniHumanProvider,
    wait_for_digital_human_task,
)
from backend.app.services.idle_video import VolcengineJimengIdleVideoProvider
from backend.app.services.reports import LocalRuleReportProvider
from backend.app.services.classroom_analysis import DoubaoVideoAnalysisProvider


def test_invalid_timeline_is_reported(tmp_path):
    path = tmp_path / "bad.json"
    path.write_text("not-json", encoding="utf-8")
    with pytest.raises(EventDataError):
        JsonEventStore(path).load()


def test_report_accumulates_duration():
    raw = {
        "id": "e1",
        "time": 1,
        "duration": 12,
        "students": [{"id": "s1", "label": "一号", "rect": {"x": 0, "y": 0, "width": 0.2, "height": 0.2}}],
        "behavior": "低头",
        "speech": "请抬头",
        "severity": "warning",
    }
    first = BehaviorEvent.model_validate(raw)
    second = BehaviorEvent.model_validate({**raw, "id": "e2", "time": 20, "duration": 8})
    report = LocalRuleReportProvider().generate([first, second], {"e1", "e2"})
    stat = report.students[0].behaviors["低头"]
    assert stat.count == 2
    assert stat.duration == 20


def test_positive_observation_is_reported_without_reminder():
    event = BehaviorEvent.model_validate(
        {
            "id": "focus-1",
            "time": 1,
            "duration": 18,
            "students": [
                {
                    "id": "r1-s1",
                    "label": "第一排第一位",
                    "rect": {"x": 0.2, "y": 0.2, "width": 0.2, "height": 0.3},
                }
            ],
            "behavior": "专注学习",
            "speech": "",
            "severity": "info",
        }
    )
    report = LocalRuleReportProvider().generate([event], {event.id})
    assert report.students[0].reminder_count == 0
    assert report.students[0].behaviors["专注学习"].duration == 18
    assert report.students[0].summary == "本次学习过程中一直保持专注学习。无其他分心行为。"


class NeverReadyProvider(DigitalHumanProvider):
    name = "never-ready"

    async def create_talking_video(self, image_url: str, audio_url: str):
        raise NotImplementedError

    async def get_task_status(self, task_id: str):
        return DigitalHumanResult(task_id=task_id, status="preparing")


def test_digital_human_polling_times_out():
    async def run():
        with pytest.raises(TimeoutError, match="生成超时"):
            await wait_for_digital_human_task(
                NeverReadyProvider(), "task-1", timeout_seconds=0.01, interval_seconds=0.001
            )

    asyncio.run(run())


def test_idle_video_provider_submits_natural_motion_payload():
    provider = VolcengineJimengIdleVideoProvider(
        "test-ak",
        "test-sk",
        "https://example.com/submit",
        "https://example.com/result",
        "cn-north-1",
        frames=121,
    )
    captured = {}

    async def fake_post(url, payload):
        captured["url"] = url
        captured["payload"] = payload
        return {"code": 10000, "data": {"task_id": "idle-task-1"}}

    provider.client._post = fake_post

    async def run():
        task = await provider.create_idle_video("https://example.com/teacher.png", "自然眨眼和呼吸")
        assert task.task_id == "idle-task-1"

    asyncio.run(run())
    assert captured["url"] == "https://example.com/submit"
    assert captured["payload"] == {
        "req_key": "jimeng_i2v_first_v30",
        "image_urls": ["https://example.com/teacher.png"],
        "prompt": "自然眨眼和呼吸",
        "seed": -1,
        "frames": 121,
    }


def test_cloud_video_url_accepts_list_and_nested_shapes():
    assert VolcengineOmniHumanProvider._first_media_url(
        [None, {"main": "https://example.com/result.mp4"}]
    ) == "https://example.com/result.mp4"
    assert VolcengineOmniHumanProvider._first_media_url({"bad": ["not-a-url"]}) is None


def test_doubao_video_analysis_normalizes_model_coordinates_and_ids():
    raw = [
        {
            "id": "event-1",
            "time": 9.5,
            "duration": 5,
            "students": [
                {
                    "id": "seat-1",
                    "label": "第一排第一位",
                    "rect": {"x": 0.95, "y": 0.9, "width": 0.2, "height": 0.3},
                }
            ],
            "behavior": "使用手机",
            "speech": "第一排第一位同学，请收起手机。",
            "severity": "warning",
        },
        {
            "id": "event-1",
            "time": 20,
            "duration": 4,
            "students": [
                {
                    "id": "seat-1",
                    "label": "第一排第一位",
                    "rect": {"x": 0.2, "y": 0.2, "width": 0.1, "height": 0.2},
                }
            ],
            "behavior": "回头交谈",
            "speech": "请停止交谈。",
            "severity": "unknown",
        },
        {
            "id": "focus-1",
            "time": 2,
            "duration": 12,
            "students": [
                {
                    "id": "seat-2",
                    "label": "第一排第二位",
                    "rect": {"x": 0.4, "y": 0.3, "width": 0.15, "height": 0.3},
                }
            ],
            "behavior": "专注学习",
            "speech": "",
            "severity": "info",
        },
    ]
    events = DoubaoVideoAnalysisProvider._normalized_events(raw, duration=30)
    assert [event.id for event in events] == ["focus-1", "event-1", "ai-event-002"]
    assert events[1].students[0].rect.x + events[1].students[0].rect.width <= 1
    assert events[0].severity == "info"
    assert events[0].speech == ""
    assert events[2].severity == "warning"
