import io

from fastapi.testclient import TestClient
from PIL import Image

from backend.app.config import Settings, get_settings
from backend.app.main import app


test_settings = Settings(
    _env_file=None,
    digital_human_provider="mock",
    tts_provider="mock",
    media_store_provider="local",
    volcengine_access_key="",
    volcengine_secret_key="",
    doubao_tts_app_id="",
    doubao_tts_access_token="",
)
app.dependency_overrides[get_settings] = lambda: test_settings
client = TestClient(app)


def make_png() -> bytes:
    stream = io.BytesIO()
    Image.new("RGB", (80, 100), "#3b82f6").save(stream, format="PNG")
    return stream.getvalue()


def test_health_defaults_to_mock():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_events_are_valid_and_sorted():
    response = client.get("/api/events")
    assert response.status_code == 200
    events = response.json()
    assert len(events) >= 1
    assert [event["time"] for event in events] == sorted(event["time"] for event in events)


def test_classroom_analysis_uses_json_fallback_without_ark_key():
    response = client.post("/api/classroom-analysis", json={"duration": 300, "force": True})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert data["provider"] == "json-fallback"
    assert data["used_fallback"] is True
    assert data["events"]


def test_upload_teacher_and_mock_ready():
    response = client.post("/api/teacher", files={"photo": ("teacher.png", make_png(), "image/png")})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert data["image_url"].startswith("http")
    assert data["idle_video_url"] is None
    assert data["idle_provider"] == "mock-css-idle"
    assert data["speech_audio_urls"] == {}


def test_upload_teacher_static_mode_skips_digital_human_generation():
    response = client.post(
        "/api/teacher",
        data={"mode": "static", "analysis_task_id": "analysis-demo"},
        files={"photo": ("teacher.png", make_png(), "image/png")},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert data["provider"] == "static-photo"
    assert data["idle_provider"] == "static-photo"
    assert data["idle_video_url"] is None
    assert data["talking_videos"] == {}
    assert data["analysis_task_id"] == "analysis-demo"


def test_rejects_invalid_image_type():
    response = client.post("/api/teacher", files={"photo": ("bad.txt", b"no", "text/plain")})
    assert response.status_code == 415


def test_tts_has_audible_local_or_browser_fallback():
    response = client.post("/api/tts", json={"text": "请集中注意力"})
    assert response.status_code == 200
    data = response.json()
    assert data["audio_url"] or data["browser_fallback"]
    if data["audio_url"]:
        assert data["audio_url"].endswith(".wav")
        media_path = data["audio_url"].split("/media/audio/")[1]
        media = client.get(f"/media/audio/{media_path}")
        assert media.status_code == 200
        assert len(media.content) > 100
    assert data["message"]


def test_report_groups_students_and_behaviors():
    response = client.post("/api/reports", json={"triggered_event_ids": ["event-001"]})
    assert response.status_code == 200
    data = response.json()
    assert data["generated_by"] == "local-rules"
    assert data["total_events"] == 1
    assert {student["student_id"] for student in data["students"]} == {"r1-s2"}


def test_empty_triggered_set_produces_empty_report():
    response = client.post("/api/reports", json={"triggered_event_ids": []})
    assert response.status_code == 200
    assert response.json()["total_events"] == 0
    assert response.json()["students"] == []


def test_live_camera_session_degrades_without_ark_key_but_keeps_running():
    created = client.post("/api/live-sessions")
    assert created.status_code == 200
    session = created.json()
    assert session["provider"] == "unavailable"
    frame = client.post(
        f"/api/live-sessions/{session['session_id']}/frames",
        data={"elapsed": "3.0"},
        files={"frame": ("frame.png", make_png(), "image/png")},
    )
    assert frame.status_code == 200
    assert frame.json()["status"] == "degraded"
    assert frame.json()["events"] == []

    report = client.post(f"/api/live-sessions/{session['session_id']}/finish")
    assert report.status_code == 200
    assert report.json()["students"] == []
