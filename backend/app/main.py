import asyncio
import base64
import hashlib
import io
import json
import os
from pathlib import Path
from typing import Dict, Literal, Optional
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError

from .config import Settings, get_settings
from .models import (
    AudioResponse,
    ClassroomAnalysisRequest,
    ClassroomAnalysisTask,
    ClassroomReport,
    LiveFrameAnalysis,
    LiveSession,
    ReportRequest,
    TTSRequest,
    TeacherAsset,
)
from .services.classroom_analysis import (
    ClassroomAnalysisProvider,
    DoubaoVideoAnalysisProvider,
    JsonTimelineAnalysisProvider,
)
from .services.digital_human import (
    DigitalHumanProvider,
    MockDigitalHumanProvider,
    VolcengineOmniHumanProvider,
    wait_for_digital_human_task,
)
from .services.event_store import EventDataError, JsonEventStore
from .services.idle_video import (
    IdleVideoProvider,
    MockIdleVideoProvider,
    VolcengineJimengIdleVideoProvider,
)
from .services.event_overrides import apply_event_overrides, load_event_overrides
from .services.live_sessions import LiveSessionState
from .services.media_store import LocalMediaStore, MediaStore, TOSMediaStore
from .services.reports import LocalRuleReportProvider
from .services.tts import DoubaoTTSProvider, MockTTSProvider, TTSProvider, WindowsSapiTTSProvider


app = FastAPI(title="AI 数字教师课堂监督系统", version="1.0.0")
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
settings.upload_dir.mkdir(parents=True, exist_ok=True)
settings.audio_dir.mkdir(parents=True, exist_ok=True)
settings.generated_dir.mkdir(parents=True, exist_ok=True)
settings.analysis_dir.mkdir(parents=True, exist_ok=True)
app.mount("/media/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")
app.mount("/media/audio", StaticFiles(directory=settings.audio_dir), name="audio")
app.mount("/media/generated", StaticFiles(directory=settings.generated_dir), name="generated")

_teacher_tasks: Dict[str, TeacherAsset] = {}
_analysis_tasks: Dict[str, ClassroomAnalysisTask] = {}
_live_sessions: Dict[str, LiveSessionState] = {}


def select_classroom_analysis(config: Settings) -> ClassroomAnalysisProvider:
    configured = bool(config.ark_api_key and config.ark_video_model)
    if config.classroom_analysis_provider == "doubao" and not configured:
        raise RuntimeError("已选择豆包视频理解，但 ARK_API_KEY 或 ARK_VIDEO_MODEL 未配置")
    if config.classroom_analysis_provider == "doubao" or (
        config.classroom_analysis_provider == "auto" and configured
    ):
        return DoubaoVideoAnalysisProvider(
            api_key=config.ark_api_key,
            base_url=config.ark_base_url,
            model=config.ark_video_model,
            fps=config.ark_video_fps,
            max_output_tokens=config.ark_video_max_output_tokens,
            timeout_seconds=config.classroom_analysis_timeout_seconds,
        )
    return JsonTimelineAnalysisProvider(JsonEventStore(config.data_file).load())


def select_digital_human(config: Settings) -> DigitalHumanProvider:
    configured = bool(
        config.volcengine_access_key
        and config.volcengine_secret_key
        and config.volcengine_omni_submit_url
        and config.volcengine_omni_result_url
    )
    if config.digital_human_provider == "volcengine" and not configured:
        raise RuntimeError("已选择火山引擎数字人，但相关环境变量不完整")
    if config.digital_human_provider == "volcengine" or (
        config.digital_human_provider == "auto" and configured
    ):
        return VolcengineOmniHumanProvider(
            config.volcengine_access_key,
            config.volcengine_secret_key,
            config.volcengine_omni_submit_url,
            config.volcengine_omni_result_url,
            config.volcengine_region,
        )
    return MockDigitalHumanProvider()


def select_tts(config: Settings) -> TTSProvider:
    configured = bool(config.doubao_tts_app_id and config.doubao_tts_access_token)
    if config.tts_provider == "doubao" and not configured:
        raise RuntimeError("已选择豆包 TTS，但相关环境变量不完整")
    if config.tts_provider == "doubao" or (config.tts_provider == "auto" and configured):
        return DoubaoTTSProvider(
            config.doubao_tts_app_id,
            config.doubao_tts_access_token,
            config.doubao_tts_cluster,
            config.doubao_tts_voice,
        )
    if config.tts_provider == "auto" and os.name == "nt":
        return WindowsSapiTTSProvider(config.audio_dir, config.public_base_url)
    return MockTTSProvider()


def select_idle_video(config: Settings) -> IdleVideoProvider:
    configured = bool(
        config.volcengine_access_key
        and config.volcengine_secret_key
        and config.volcengine_idle_submit_url
        and config.volcengine_idle_result_url
    )
    if config.idle_video_provider == "volcengine" and not configured:
        raise RuntimeError("已选择即梦待机动画，但相关环境变量不完整")
    if config.idle_video_provider == "volcengine" or (
        config.idle_video_provider == "auto" and configured
    ):
        return VolcengineJimengIdleVideoProvider(
            config.volcengine_access_key,
            config.volcengine_secret_key,
            config.volcengine_idle_submit_url,
            config.volcengine_idle_result_url,
            config.volcengine_region,
            config.idle_video_frames,
        )
    return MockIdleVideoProvider()


def select_media_store(config: Settings) -> MediaStore:
    configured = bool(
        config.volcengine_access_key
        and config.volcengine_secret_key
        and config.tos_bucket
        and config.tos_region
        and config.tos_endpoint
    )
    if config.media_store_provider == "tos" and not configured:
        raise RuntimeError("已选择 TOS，但 Bucket、Region、Endpoint 或 AK/SK 不完整")
    if config.media_store_provider == "tos" or (
        config.media_store_provider == "auto" and configured
    ):
        return TOSMediaStore(
            config.volcengine_access_key,
            config.volcengine_secret_key,
            config.tos_endpoint,
            config.tos_region,
            config.tos_bucket,
            config.tos_url_expires_seconds,
        )
    return LocalMediaStore(config.upload_dir, config.public_base_url)


@app.exception_handler(EventDataError)
async def event_data_error_handler(_, exc: EventDataError):
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.get("/api/health")
async def health(config: Settings = Depends(get_settings)):
    try:
        digital_provider = select_digital_human(config).name
    except RuntimeError as exc:
        digital_provider = f"配置错误：{exc}"
    try:
        tts_provider = select_tts(config).name
    except RuntimeError as exc:
        tts_provider = f"配置错误：{exc}"
    try:
        media_provider = select_media_store(config).name
    except RuntimeError as exc:
        media_provider = f"配置错误：{exc}"
    try:
        idle_provider = select_idle_video(config).name
    except RuntimeError as exc:
        idle_provider = f"配置错误：{exc}"
    try:
        analysis_provider = select_classroom_analysis(config).name
    except RuntimeError as exc:
        analysis_provider = f"配置错误：{exc}"
    return {
        "status": "ok",
        "digital_human_provider": digital_provider,
        "tts_provider": tts_provider,
        "media_store_provider": media_provider,
        "idle_video_provider": idle_provider,
        "classroom_analysis_provider": analysis_provider,
        "mock_mode": digital_provider == "mock",
    }


@app.get("/api/events")
async def get_events(config: Settings = Depends(get_settings)):
    return JsonEventStore(config.data_file).load()


@app.post("/api/live-sessions", response_model=LiveSession)
async def create_live_session(config: Settings = Depends(get_settings)):
    session_id = f"live-{uuid4().hex}"
    try:
        provider = select_classroom_analysis(config)
        configured = isinstance(provider, DoubaoVideoAnalysisProvider)
    except RuntimeError:
        provider = JsonTimelineAnalysisProvider([])
        configured = False
    provider_name = provider.name if configured else "unavailable"
    message = (
        "摄像头课堂监督已就绪，数字教师将按间隔分析实时画面"
        if configured
        else "摄像头已可使用，但豆包视觉模型尚未配置；画面会继续显示，分析暂不可用"
    )
    state = LiveSessionState(
        session_id=session_id,
        provider=provider_name,
        interval_seconds=config.live_analysis_interval_seconds,
    )
    _live_sessions[session_id] = state
    return LiveSession(
        session_id=session_id,
        provider=provider_name,
        message=message,
        analysis_interval_seconds=state.interval_seconds,
    )


@app.post("/api/live-sessions/{session_id}/frames", response_model=LiveFrameAnalysis)
async def analyze_live_frame(
    session_id: str,
    frame: UploadFile = File(...),
    elapsed: float = Form(..., ge=0),
    config: Settings = Depends(get_settings),
):
    state = _live_sessions.get(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="课堂监督会话不存在或服务已重启")
    if state.status == "finished":
        raise HTTPException(status_code=409, detail="课堂监督已经结束")
    if frame.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="摄像头画面格式不受支持")
    max_bytes = config.live_frame_max_size_mb * 1024 * 1024
    data = await frame.read(max_bytes + 1)
    validate_image(frame, data, max_bytes)

    async with state.lock:
        try:
            provider = select_classroom_analysis(config)
            if not isinstance(provider, DoubaoVideoAnalysisProvider):
                raise RuntimeError("请在 .env 配置 ARK_API_KEY 和 ARK_VIDEO_MODEL")
            provider.timeout_seconds = config.live_analysis_timeout_seconds
            encoded = base64.b64encode(data).decode("ascii")
            image_url = f"data:{frame.content_type};base64,{encoded}"
            result = await asyncio.wait_for(
                provider.analyze_frame(
                    image_url,
                    elapsed,
                    state.known_student_context(),
                    state.interval_seconds,
                ),
                timeout=config.live_analysis_timeout_seconds,
            )
            events = state.record_frame(result.events, elapsed, result.classroom_summary)
            state.provider = provider.name
            return LiveFrameAnalysis(
                session_id=session_id,
                status="ready",
                provider=provider.name,
                message="数字教师已完成当前课堂画面分析",
                elapsed=elapsed,
                events=events,
                sample_count=state.sample_count,
                total_events=len(state.events),
            )
        except Exception as exc:
            state.sample_count += 1
            state.status = "monitoring"
            return LiveFrameAnalysis(
                session_id=session_id,
                status="degraded",
                provider=state.provider,
                message=f"本次画面分析未完成，课堂监督将自动继续：{exc}",
                elapsed=elapsed,
                events=[],
                sample_count=state.sample_count,
                total_events=len(state.events),
            )


@app.post("/api/live-sessions/{session_id}/finish", response_model=ClassroomReport)
async def finish_live_session(session_id: str):
    state = _live_sessions.get(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="课堂监督会话不存在或服务已重启")
    # 等待已经提交的最后一帧分析结束，避免用户点击“结束监督”时
    # 报告与仍在写入的分析结果发生竞争。
    async with state.lock:
        state.status = "finished"
        events = state.all_events()
        report = LocalRuleReportProvider().generate(events, {event.id for event in events})
        report.classroom_summary = state.classroom_summary()
        return report


def _analysis_cache_path(config: Settings) -> Path:
    path = config.classroom_video_path
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    digest.update(config.ark_video_model.encode("utf-8"))
    digest.update(str(config.ark_video_fps).encode("ascii"))
    digest.update(b"classroom-analysis-prompt-v2-positive-observations")
    return config.analysis_dir / f"{digest.hexdigest()}.json"


def _load_analysis_cache(path: Path, task_id: str) -> Optional[ClassroomAnalysisTask]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["task_id"] = task_id
        return ClassroomAnalysisTask.model_validate(payload)
    except (FileNotFoundError, json.JSONDecodeError, ValueError):
        return None


def _save_analysis_cache(path: Path, task: ClassroomAnalysisTask) -> None:
    payload = task.model_dump(mode="json")
    payload.pop("task_id", None)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _apply_reviewed_event_overrides(
    task: ClassroomAnalysisTask, duration: float, config: Settings
) -> None:
    override_path = config.data_file.with_name("event_overrides.json")
    override_config = load_event_overrides(override_path)
    reviewed_events, applied = apply_event_overrides(task.events, override_config, duration)
    if not applied:
        return
    task.events = reviewed_events
    if override_config.classroom_summary:
        task.classroom_summary = override_config.classroom_summary


async def _video_url_for_analysis(config: Settings) -> str:
    video_path = config.classroom_video_path
    data = await asyncio.to_thread(video_path.read_bytes)
    store = select_media_store(config)
    if store.name == "tos":
        return await asyncio.to_thread(store.save_bytes, data, ".mp4", "video/mp4")
    max_bytes = config.classroom_analysis_max_video_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise RuntimeError(
            f"课堂视频超过 {config.classroom_analysis_max_video_mb}MB，请配置 TOS 后再调用豆包视频理解"
        )
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:video/mp4;base64,{encoded}"


async def _prepare_classroom_analysis(
    task_id: str, duration: float, force: bool, config: Settings
) -> None:
    task = _analysis_tasks[task_id]
    fallback = JsonTimelineAnalysisProvider(JsonEventStore(config.data_file).load())
    try:
        cache_path = await asyncio.to_thread(_analysis_cache_path, config)
        if not force:
            cached = await asyncio.to_thread(_load_analysis_cache, cache_path, task_id)
            if cached and cached.status == "ready":
                _apply_reviewed_event_overrides(cached, duration, config)
                cached.message = "数字教师已读取该课堂视频的智能分析结果"
                _analysis_tasks[task_id] = cached
                return

        provider = select_classroom_analysis(config)
        if provider.name == fallback.name:
            result = await provider.analyze("", duration)
            task.provider = provider.name
            task.events = result.events
            task.classroom_summary = result.classroom_summary
            task.used_fallback = True
            task.progress = 100
            task.status = "ready"
            task.message = "智能分析服务未配置，数字教师已使用本地时间轴完成课堂准备"
            _apply_reviewed_event_overrides(task, duration, config)
            return

        task.provider = provider.name
        task.progress = 15
        task.message = "数字教师正在准备课堂视频…"
        video_url = await _video_url_for_analysis(config)
        task.progress = 35
        task.message = "数字教师正在完整分析课堂视频并识别学生状态…"
        result = await asyncio.wait_for(
            provider.analyze(video_url, duration),
            timeout=config.classroom_analysis_timeout_seconds,
        )
        task.events = result.events
        task.classroom_summary = result.classroom_summary
        task.progress = 100
        task.status = "ready"
        task.message = "数字教师已完成课堂视频分析，学生状态和课堂总结已生成"
        _apply_reviewed_event_overrides(task, duration, config)
        await asyncio.to_thread(_save_analysis_cache, cache_path, task)
    except Exception as exc:
        result = await fallback.analyze("", duration)
        task.provider = fallback.name
        task.events = result.events
        task.classroom_summary = result.classroom_summary
        task.used_fallback = True
        task.progress = 100
        task.status = "ready"
        task.message = f"数字教师云端分析暂不可用，已使用本地时间轴继续演示：{exc}"
        _apply_reviewed_event_overrides(task, duration, config)


@app.post("/api/classroom-analysis", response_model=ClassroomAnalysisTask)
async def create_classroom_analysis(
    payload: ClassroomAnalysisRequest, config: Settings = Depends(get_settings)
):
    if not config.classroom_video_path.exists():
        raise HTTPException(status_code=404, detail="课堂视频不存在，请放置 frontend/public/classroom.mp4")
    task = ClassroomAnalysisTask(
        task_id=f"analysis-{uuid4().hex}",
        status="preparing",
        provider="pending",
        message="数字教师正在启动课堂视频分析…",
        progress=5,
    )
    _analysis_tasks[task.task_id] = task
    try:
        provider = select_classroom_analysis(config)
    except RuntimeError:
        provider = JsonTimelineAnalysisProvider(JsonEventStore(config.data_file).load())
    if provider.name == "json-fallback":
        await _prepare_classroom_analysis(task.task_id, payload.duration, True, config)
    else:
        asyncio.create_task(_prepare_classroom_analysis(task.task_id, payload.duration, payload.force, config))
    return _analysis_tasks[task.task_id]


@app.get("/api/classroom-analysis/{task_id}", response_model=ClassroomAnalysisTask)
async def get_classroom_analysis(task_id: str):
    task = _analysis_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="课堂分析任务不存在或服务已重启")
    return task


def _events_for_analysis(task_id: Optional[str], config: Settings):
    if not task_id:
        return JsonEventStore(config.data_file).load()
    task = _analysis_tasks.get(task_id)
    if not task or task.status != "ready":
        raise HTTPException(status_code=400, detail="课堂视频尚未完成分析")
    return task.events


def validate_image(upload: UploadFile, data: bytes, max_bytes: int) -> None:
    if upload.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="仅支持 JPG、PNG 或 WebP 图片")
    if len(data) > max_bytes:
        raise HTTPException(status_code=413, detail=f"图片不能超过 {max_bytes // 1024 // 1024}MB")
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=415, detail="图片内容无效或已损坏") from exc


def audio_urls_for_teacher(result, store: MediaStore, config: Settings) -> tuple[str, str]:
    """返回提交给云端的公网音频 URL 和供浏览器播放的本地稳定 URL。"""
    if not result.audio_url:
        raise RuntimeError("语音服务没有返回可提交给 OmniHuman 的音频")
    if not result.audio_url.startswith("data:"):
        return result.audio_url, result.audio_url
    try:
        header, encoded = result.audio_url.split(",", 1)
        content_type = header.split(";", 1)[0].split(":", 1)[1]
        suffix = ".mp3" if "mpeg" in content_type or "mp3" in content_type else ".wav"
        data = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise RuntimeError("语音服务返回了无效的音频数据") from exc
    cloud_url = store.save_bytes(data, suffix, content_type)
    filename = f"tts-{uuid4().hex}{suffix}"
    (config.audio_dir / filename).write_bytes(data)
    return cloud_url, f"/media/audio/{filename}"


async def cache_generated_video(remote_url: str, config: Settings, label: str) -> str:
    """立即固化供应商短期链接，避免浏览器受链接过期、跨域或防盗链影响。"""
    try:
        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            response = await client.get(remote_url)
            response.raise_for_status()
    except Exception as exc:
        raise RuntimeError(f"{label}已生成，但下载到本地失败：{exc}") from exc

    content = response.content
    if not content:
        raise RuntimeError(f"{label}已生成，但下载结果为空")
    if len(content) > 100 * 1024 * 1024:
        raise RuntimeError(f"{label}文件超过 100MB，已拒绝缓存")
    content_type = response.headers.get("content-type", "").lower()
    if "text/html" in content_type or content.lstrip().startswith(b"<html"):
        raise RuntimeError(f"{label}下载地址返回了网页而不是视频")

    filename = f"{uuid4().hex}.mp4"
    target = config.generated_dir / filename
    await asyncio.to_thread(target.write_bytes, content)
    return f"/media/generated/{filename}"


async def _prepare_cloud_teacher_assets(task_id: str, config: Settings) -> None:
    asset = _teacher_tasks[task_id]
    provider = select_digital_human(config)
    idle_provider = select_idle_video(config)
    tts = select_tts(config)
    store = select_media_store(config)
    events = _events_for_analysis(asset.analysis_task_id, config)
    reminder_events = [event for event in events if event.severity != "info" and event.speech.strip()]

    async def prepare_idle_video() -> Optional[str]:
        asset.idle_provider = idle_provider.name
        if idle_provider.name == "mock-css-idle":
            return None
        job = await asyncio.wait_for(
            idle_provider.create_idle_video(asset.image_url, config.idle_video_prompt),
            timeout=config.idle_video_timeout_seconds,
        )
        result = await wait_for_digital_human_task(
            idle_provider,  # type: ignore[arg-type]
            job.task_id,
            timeout_seconds=config.idle_video_timeout_seconds,
            interval_seconds=3,
        )
        if result.status != "ready" or not result.video_url:
            raise RuntimeError(result.error or "待机动画生成失败")
        asset.message = "自然待机动作已生成，正在保存到本地…"
        return await cache_generated_video(result.video_url, config, "自然待机动画")

    async def prepare_talking_videos() -> dict[str, str]:
        submitted = []
        total_steps = max(1, len(reminder_events) * 2)
        for index, event in enumerate(reminder_events):
            audio = await asyncio.wait_for(tts.synthesize(event.speech), timeout=35)
            audio_url, playback_audio_url = await asyncio.to_thread(
                audio_urls_for_teacher,
                audio,
                store,
                config,
            )
            asset.speech_audio_urls[event.id] = playback_audio_url
            job = await asyncio.wait_for(
                provider.create_talking_video(asset.image_url, audio_url),
                timeout=config.digital_human_timeout_seconds,
            )
            submitted.append((event.id, job.task_id))
            asset.progress = max(asset.progress, 10 + int((index * 2 + 1) / total_steps * 65))
            asset.message = f"正在生成自然待机动作；已提交 {index + 1}/{len(reminder_events)} 条口型提醒"

        async def wait_one(event_id: str, provider_task_id: str):
            result = await wait_for_digital_human_task(
                provider,
                provider_task_id,
                timeout_seconds=config.digital_human_timeout_seconds,
                interval_seconds=3,
            )
            if result.status != "ready" or not result.video_url:
                raise RuntimeError(result.error or f"事件 {event_id} 的数字人视频生成失败")
            local_url = await cache_generated_video(
                result.video_url,
                config,
                f"事件 {event_id} 的口型视频",
            )
            return event_id, local_url

        completed = await asyncio.gather(*(wait_one(*item) for item in submitted))
        return dict(completed)

    results = await asyncio.gather(
        prepare_idle_video(),
        prepare_talking_videos(),
        return_exceptions=True,
    )
    idle_result, talking_result = results

    issues: list[str] = []
    if isinstance(idle_result, BaseException):
        asset.idle_video_url = None
        asset.idle_provider = "mock-css-fallback"
        issues.append(f"待机动画使用本地效果（{idle_result}）")
    else:
        asset.idle_video_url = idle_result

    if isinstance(talking_result, BaseException):
        asset.talking_videos = {}
        asset.provider = "mock-talking-fallback"
        issues.append(f"说话状态使用本地效果（{talking_result}）")
    else:
        asset.talking_videos = talking_result

    asset.progress = 100
    asset.status = "ready"
    if issues:
        asset.message = "数字教师已可使用；" + "；".join(issues)
    else:
        asset.message = (
            f"数字教师已准备完成：自然待机动画 + {len(asset.talking_videos)} 条口型同步提醒"
            if reminder_events
            else "数字教师已准备完成：自然待机动画；本次课堂未发现需要语音提醒的行为"
        )


async def prepare_cloud_teacher(task_id: str, config: Settings) -> None:
    """后台准备云端资源；任何异常都必须落到可用的本地照片动效。"""
    try:
        await _prepare_cloud_teacher_assets(task_id, config)
    except Exception as exc:
        asset = _teacher_tasks[task_id]
        asset.status = "ready"
        asset.provider = "mock-fallback"
        asset.idle_provider = "mock-css-fallback"
        asset.progress = 100
        asset.message = f"云端资源准备失败，已自动切换照片动效：{exc}"


@app.post("/api/teacher", response_model=TeacherAsset)
async def upload_teacher_photo(
    photo: UploadFile = File(...),
    analysis_task_id: Optional[str] = Form(None),
    mode: Literal["static", "dynamic"] = Form("dynamic"),
    config: Settings = Depends(get_settings),
):
    if photo.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="仅支持 JPG、PNG 或 WebP 图片")
    suffix = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
    }[photo.content_type]
    max_bytes = config.max_image_size_mb * 1024 * 1024
    data = await photo.read(max_bytes + 1)
    validate_image(photo, data, max_bytes)

    if mode == "static":
        local_store = LocalMediaStore(config.upload_dir, config.public_base_url)
        image_url = local_store.save_bytes(data, suffix, photo.content_type or "image/jpeg")
        asset = TeacherAsset(
            task_id=f"static-{uuid4().hex}",
            status="ready",
            provider="static-photo",
            image_url=image_url,
            message="课堂监督员照片已准备完成",
            progress=100,
            idle_provider="static-photo",
            analysis_task_id=analysis_task_id,
        )
        _teacher_tasks[asset.task_id] = asset
        return asset

    try:
        provider = select_digital_human(config)
        store = select_media_store(config)
        if provider.name == "mock":
            local_store = LocalMediaStore(config.upload_dir, config.public_base_url)
            image_url = local_store.save_bytes(data, suffix, photo.content_type or "image/jpeg")
            task = await provider.create_talking_video(image_url, "")
            asset = TeacherAsset(
                task_id=task.task_id,
                status="ready",
                provider=provider.name,
                image_url=image_url,
                message="数字教师已准备完成（本地 Mock 模式）",
                progress=100,
                idle_provider="mock-css-idle",
                analysis_task_id=analysis_task_id,
            )
        else:
            if store.name != "tos":
                raise RuntimeError("真实 OmniHuman 必须配置 TOS 媒体存储")
            image_url = await asyncio.to_thread(
                store.save_bytes, data, suffix, photo.content_type or "image/jpeg"
            )
            asset = TeacherAsset(
                task_id=f"profile-{uuid4().hex}",
                status="preparing",
                provider=provider.name,
                image_url=image_url,
                message="教师照片已上传，正在生成自然待机动作和口型同步提醒…",
                progress=5,
                idle_provider=select_idle_video(config).name,
                analysis_task_id=analysis_task_id,
            )
            _teacher_tasks[asset.task_id] = asset
            asyncio.create_task(prepare_cloud_teacher(asset.task_id, config))
    except Exception as exc:
        # 外部数字人失败时保留已上传照片，并切换为可用的 Mock 形象。
        local_store = LocalMediaStore(config.upload_dir, config.public_base_url)
        image_url = local_store.save_bytes(data, suffix, photo.content_type or "image/jpeg")
        fallback = await MockDigitalHumanProvider().create_talking_video(image_url, "")
        asset = TeacherAsset(
            task_id=fallback.task_id,
            status="ready",
            provider="mock-fallback",
            image_url=image_url,
            message=f"外部数字人不可用，已自动切换本地模式：{exc}",
            progress=100,
            idle_provider="mock-css-fallback",
            analysis_task_id=analysis_task_id,
        )
    _teacher_tasks[asset.task_id] = asset
    return asset


@app.get("/api/digital-human/tasks/{task_id}", response_model=TeacherAsset)
async def get_teacher_task(task_id: str):
    asset = _teacher_tasks.get(task_id)
    if not asset:
        raise HTTPException(status_code=404, detail="数字教师任务不存在或服务已重启")
    return asset


@app.post("/api/tts", response_model=AudioResponse)
async def synthesize_speech(payload: TTSRequest, config: Settings = Depends(get_settings)):
    try:
        result = await asyncio.wait_for(select_tts(config).synthesize(payload.text, payload.voice), timeout=35)
    except Exception as exc:
        fallback = await MockTTSProvider().synthesize(payload.text, payload.voice)
        fallback.message = f"云端语音失败，已切换浏览器语音：{exc}"
        result = fallback
    return AudioResponse(**result.__dict__)


@app.post("/api/reports", response_model=ClassroomReport)
async def generate_report(payload: ReportRequest, config: Settings = Depends(get_settings)):
    events = _events_for_analysis(payload.analysis_task_id, config)
    known_ids = {event.id for event in events}
    unknown = set(payload.triggered_event_ids) - known_ids
    if unknown:
        raise HTTPException(status_code=400, detail=f"未知事件 ID：{', '.join(sorted(unknown))}")
    report = LocalRuleReportProvider().generate(events, set(payload.triggered_event_ids))
    if payload.analysis_task_id:
        task = _analysis_tasks.get(payload.analysis_task_id)
        if task:
            report.classroom_summary = task.classroom_summary
    return report
