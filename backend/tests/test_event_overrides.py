from backend.app.models import BehaviorEvent, Rect, StudentRef
from backend.app.services.event_overrides import (
    BehaviorOverride,
    EventOverrideConfig,
    apply_event_overrides,
)


def student(student_id: str, label: str) -> StudentRef:
    return StudentRef(
        id=student_id,
        label=label,
        rect=Rect(x=0.1, y=0.2, width=0.2, height=0.3),
    )


def test_reviewed_alert_splits_conflicting_focus_intervals():
    events = [
        BehaviorEvent(
            id="focus-1",
            time=0,
            duration=30,
            students=[student("r1-s1", "第一排第一位")],
            behavior="专注学习",
            speech="",
            severity="info",
        ),
        BehaviorEvent(
            id="focus-2",
            time=0,
            duration=30,
            students=[student("r1-s2", "第一排第二位")],
            behavior="专注学习",
            speech="",
            severity="info",
        ),
    ]
    config = EventOverrideConfig(
        events=[
            BehaviorOverride(
                id="reviewed-talk",
                time=10,
                duration=6,
                student_ids=["r1-s1", "r1-s2"],
                behavior="交头接耳",
                speech="请不要交头接耳。",
                severity="alert",
            )
        ]
    )

    reviewed, applied = apply_event_overrides(events, config, 30)

    assert applied is True
    alert = next(event for event in reviewed if event.id == "reviewed-talk")
    assert alert.time == 10
    assert alert.duration == 6
    assert {student.id for student in alert.students} == {"r1-s1", "r1-s2"}
    assert not any(
        event.severity == "info"
        and any(student.id in {"r1-s1", "r1-s2"} for student in event.students)
        and event.time < 16
        and event.time + event.duration > 10
        for event in reviewed
    )


def test_override_is_idempotent_after_cache_is_saved():
    alert = BehaviorEvent(
        id="reviewed-talk",
        time=10,
        duration=6,
        students=[student("r1-s1", "第一排第一位")],
        behavior="交头接耳",
        speech="请不要交头接耳。",
        severity="alert",
    )
    config = EventOverrideConfig(
        events=[
            BehaviorOverride(
                id="reviewed-talk",
                time=10,
                duration=6,
                student_ids=["r1-s1"],
                behavior="交头接耳",
                speech="请不要交头接耳。",
                severity="alert",
            )
        ]
    )

    reviewed, applied = apply_event_overrides([alert], config, 30)

    assert applied is True
    assert [event.id for event in reviewed] == ["reviewed-talk"]
