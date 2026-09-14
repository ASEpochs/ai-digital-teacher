from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class Rect(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @field_validator("height")
    @classmethod
    def validate_bottom(cls, value: float, info):
        return value


class StudentRef(BaseModel):
    id: str
    label: str
    rect: Rect


class BehaviorEvent(BaseModel):
    id: str
    time: float = Field(ge=0)
    duration: float = Field(gt=0)
    students: List[StudentRef] = Field(min_length=1)
    behavior: str
    speech: str
    severity: Literal["info", "warning", "alert"]


class TeacherAsset(BaseModel):
    task_id: str
    status: Literal["preparing", "ready", "failed"]
    provider: str
    image_url: str
    message: str
    progress: int = 0
    idle_video_url: Optional[str] = None
    idle_provider: str = "mock"
    talking_videos: Dict[str, str] = Field(default_factory=dict)
    speech_audio_urls: Dict[str, str] = Field(default_factory=dict)
    analysis_task_id: Optional[str] = None


class ClassroomAnalysisRequest(BaseModel):
    duration: float = Field(gt=0, le=21600)
    force: bool = False


class ClassroomAnalysisTask(BaseModel):
    task_id: str
    status: Literal["preparing", "ready", "failed"]
    provider: str
    message: str
    progress: int = 0
    events: List[BehaviorEvent] = Field(default_factory=list)
    classroom_summary: str = ""
    used_fallback: bool = False


class LiveSession(BaseModel):
    session_id: str
    status: Literal["ready", "monitoring", "paused", "finished"] = "ready"
    provider: str
    message: str
    analysis_interval_seconds: float
    sample_count: int = 0
    total_events: int = 0


class LiveFrameAnalysis(BaseModel):
    session_id: str
    status: Literal["ready", "degraded"]
    provider: str
    message: str
    elapsed: float
    events: List[BehaviorEvent] = Field(default_factory=list)
    sample_count: int = 0
    total_events: int = 0


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=300)
    voice: Optional[str] = None


class AudioResponse(BaseModel):
    provider: str
    audio_url: Optional[str] = None
    browser_fallback: bool = False
    message: str = ""


class ReportRequest(BaseModel):
    triggered_event_ids: List[str] = Field(default_factory=list)
    analysis_task_id: Optional[str] = None


class BehaviorStat(BaseModel):
    count: int
    duration: float


class StudentTimelineItem(BaseModel):
    event_id: str
    time: float
    duration: float
    behavior: str
    severity: str


class StudentReport(BaseModel):
    student_id: str
    label: str
    behaviors: Dict[str, BehaviorStat]
    reminder_count: int
    timeline: List[StudentTimelineItem]
    summary: str


class ClassroomReport(BaseModel):
    generated_by: str
    students: List[StudentReport]
    total_events: int
    classroom_summary: str = ""
