from backend.app.models import BehaviorEvent
from backend.app.services.live_sessions import LiveSessionState


def make_event(event_id: str, student_id: str, x: float, behavior: str, severity: str, speech: str = ""):
    return BehaviorEvent.model_validate(
        {
            "id": event_id,
            "time": 0,
            "duration": 3,
            "students": [
                {
                    "id": student_id,
                    "label": "第一排第一位",
                    "rect": {"x": x, "y": 0.3, "width": 0.18, "height": 0.4},
                }
            ],
            "behavior": behavior,
            "speech": speech,
            "severity": severity,
        }
    )


def test_live_session_stabilizes_student_and_merges_continuous_behavior():
    state = LiveSessionState("live-test", "doubao", 3)
    first = state.record_frame([make_event("raw-1", "r1-s1", 0.2, "专注学习", "info")], 0, "正常")
    second = state.record_frame([make_event("raw-2", "unknown", 0.22, "专注学习", "info")], 3, "正常")

    assert first[0].id == second[0].id
    assert second[0].students[0].id == "r1-s1"
    assert second[0].duration == 6
    assert len(state.all_events()) == 1


def test_live_session_creates_one_reminder_event_for_persistent_alert():
    state = LiveSessionState("live-test", "doubao", 3)
    state.record_frame([make_event("raw-1", "r1-s1", 0.2, "专注学习", "info")], 0, "正常")
    warning = make_event("raw-2", "r1-s1", 0.2, "交头接耳", "alert", "请停止交谈。")
    first_warning = state.record_frame([warning], 3, "出现交谈")
    repeated_warning = state.record_frame([warning], 6, "仍在交谈")

    assert first_warning[0].id == repeated_warning[0].id
    assert repeated_warning[0].duration == 6
    assert len([event for event in state.all_events() if event.severity != "info"]) == 1
    assert "交头接耳" in state.classroom_summary()
