from functools import lru_cache
import os
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_env: str = "development"
    frontend_origin: str = "http://localhost:5173"
    public_base_url: str = (
        f"https://{os.environ['RENDER_EXTERNAL_HOSTNAME']}"
        if os.environ.get("RENDER_EXTERNAL_HOSTNAME")
        else "http://localhost:8000"
    )
    max_image_size_mb: int = 8

    media_store_provider: Literal["auto", "local", "tos"] = "auto"
    tos_bucket: str = ""
    tos_region: str = ""
    tos_endpoint: str = ""
    tos_url_expires_seconds: int = 3600

    digital_human_provider: Literal["auto", "mock", "volcengine"] = "auto"
    volcengine_access_key: str = ""
    volcengine_secret_key: str = ""
    volcengine_omni_submit_url: str = ""
    volcengine_omni_result_url: str = ""
    volcengine_region: str = "cn-north-1"
    digital_human_timeout_seconds: int = 300

    idle_video_provider: Literal["auto", "mock", "volcengine"] = "auto"
    volcengine_idle_submit_url: str = (
        "https://visual.volcengineapi.com/?Action=JimengI2VFirstV30SubmitTask&Version=2024-06-06"
    )
    volcengine_idle_result_url: str = (
        "https://visual.volcengineapi.com/?Action=JimengI2VFirstV30GetResult&Version=2024-06-06"
    )
    idle_video_timeout_seconds: int = 600
    idle_video_frames: int = 121
    idle_video_prompt: str = (
        "一位教师正面自然站立，保持原有人物身份、服装和背景，轻微自然眨眼，"
        "平稳呼吸，偶尔轻轻点头和小幅调整姿态，神态亲切沉稳，固定镜头，动作连续，"
        "不要说话，不要大幅转身，不要改变面部和服装"
    )

    tts_provider: Literal["auto", "mock", "doubao"] = "auto"
    doubao_tts_app_id: str = ""
    doubao_tts_access_token: str = ""
    doubao_tts_cluster: str = "volcano_tts"
    doubao_tts_voice: str = "BV700_streaming"

    classroom_analysis_provider: Literal["auto", "mock", "doubao"] = "auto"
    ark_api_key: str = ""
    ark_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    ark_video_model: str = "doubao-seed-2-0-lite-260215"
    ark_video_fps: float = 1.0
    ark_video_max_output_tokens: int = 8000
    classroom_analysis_timeout_seconds: int = 1200
    classroom_analysis_max_video_mb: int = 50
    live_analysis_interval_seconds: float = 3.0
    live_analysis_timeout_seconds: int = 45
    live_frame_max_size_mb: int = 3

    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def data_file(self) -> Path:
        return ROOT_DIR / "data" / "events.json"

    @property
    def upload_dir(self) -> Path:
        return ROOT_DIR / "backend" / "storage" / "uploads"

    @property
    def audio_dir(self) -> Path:
        return ROOT_DIR / "backend" / "storage" / "audio"

    @property
    def generated_dir(self) -> Path:
        return ROOT_DIR / "backend" / "storage" / "generated"

    @property
    def analysis_dir(self) -> Path:
        return ROOT_DIR / "backend" / "storage" / "analysis"

    @property
    def classroom_video_path(self) -> Path:
        return ROOT_DIR / "frontend" / "public" / "classroom.mp4"


@lru_cache
def get_settings() -> Settings:
    return Settings()
