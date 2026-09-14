import asyncio
import hashlib
import hmac
import json
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import parse_qsl, quote, urlparse
from uuid import uuid4

import httpx


@dataclass
class DigitalHumanTask:
    task_id: str
    status: str = "preparing"


@dataclass
class DigitalHumanResult:
    task_id: str
    status: str
    video_url: Optional[str] = None
    error: Optional[str] = None


class DigitalHumanProvider(ABC):
    name: str

    @abstractmethod
    async def create_talking_video(self, image_url: str, audio_url: str) -> DigitalHumanTask:
        raise NotImplementedError

    @abstractmethod
    async def get_task_status(self, task_id: str) -> DigitalHumanResult:
        raise NotImplementedError


class MockDigitalHumanProvider(DigitalHumanProvider):
    name = "mock"

    async def create_talking_video(self, image_url: str, audio_url: str = "") -> DigitalHumanTask:
        await asyncio.sleep(0)
        return DigitalHumanTask(task_id=f"mock-{uuid4().hex}", status="ready")

    async def get_task_status(self, task_id: str) -> DigitalHumanResult:
        return DigitalHumanResult(task_id=task_id, status="ready")


class VolcengineOmniHumanProvider(DigitalHumanProvider):
    """火山引擎 OmniHuman 1.5 Provider。

    使用 CV OpenAPI 的 HTTP 签名 V4。传入的 image_url/audio_url 必须是公网可访问 URL，
    因此生产环境应注入 TOS 等对象存储实现，而不是 LocalMediaStore。
    """

    name = "volcengine-omnihuman-v1.5"
    req_key = "jimeng_realman_avatar_picture_omni_v15"

    def __init__(
        self,
        access_key: str,
        secret_key: str,
        submit_url: str,
        result_url: str,
        region: str,
        service_name: str = "OmniHuman",
    ):
        self.access_key = access_key
        self.secret_key = secret_key
        self.submit_url = submit_url
        self.result_url = result_url
        self.region = region
        self.service_name = service_name

    @staticmethod
    def _find_value(value, names: set[str]):
        """兼容供应商网关可能增加的 Result/Response 等嵌套层。"""
        if isinstance(value, dict):
            for key, item in value.items():
                if key in names and item not in (None, ""):
                    return item
            for item in value.values():
                found = VolcengineOmniHumanProvider._find_value(item, names)
                if found not in (None, ""):
                    return found
        elif isinstance(value, list):
            for item in value:
                found = VolcengineOmniHumanProvider._find_value(item, names)
                if found not in (None, ""):
                    return found
        return None

    @staticmethod
    def _find_business_data(value):
        """定位包含任务字段的 data，避免把外层 status=10000 当成任务状态。"""
        if isinstance(value, dict):
            for key in ("data", "Data"):
                item = value.get(key)
                if isinstance(item, dict) and any(
                    field in item
                    for field in ("task_id", "taskId", "TaskId", "status", "Status", "video_url", "videoUrl", "VideoUrl")
                ):
                    return item
            for item in value.values():
                found = VolcengineOmniHumanProvider._find_business_data(item)
                if found is not None:
                    return found
        elif isinstance(value, list):
            for item in value:
                found = VolcengineOmniHumanProvider._find_business_data(item)
                if found is not None:
                    return found
        return None

    @staticmethod
    def _first_media_url(value) -> Optional[str]:
        """兼容供应商把 video_url 返回为字符串、数组或嵌套对象。"""
        if isinstance(value, str) and value.startswith(("http://", "https://")):
            return value
        if isinstance(value, list):
            for item in value:
                found = VolcengineOmniHumanProvider._first_media_url(item)
                if found:
                    return found
        if isinstance(value, dict):
            for item in value.values():
                found = VolcengineOmniHumanProvider._first_media_url(item)
                if found:
                    return found
        return None

    def _headers(self, url: str, body: bytes) -> dict:
        now = datetime.now(timezone.utc)
        date = now.strftime("%Y%m%dT%H%M%SZ")
        short_date = now.strftime("%Y%m%d")
        host = urlparse(url).netloc
        parsed = urlparse(url)
        canonical_query = "&".join(
            f"{quote(key, safe='-_.~')}={quote(value, safe='-_.~')}"
            for key, value in sorted(parse_qsl(parsed.query, keep_blank_values=True))
        )
        payload_hash = hashlib.sha256(body).hexdigest()
        canonical = f"POST\n{parsed.path or '/'}\n{canonical_query}\ncontent-type:application/json\nhost:{host}\nx-content-sha256:{payload_hash}\nx-date:{date}\n\ncontent-type;host;x-content-sha256;x-date\n{payload_hash}"
        credential_scope = f"{short_date}/{self.region}/cv/request"
        string_to_sign = "HMAC-SHA256\n{}\n{}\n{}".format(
            date, credential_scope, hashlib.sha256(canonical.encode()).hexdigest()
        )
        def sign(key: bytes, value: str) -> bytes:
            return hmac.new(key, value.encode(), hashlib.sha256).digest()
        signing_key = sign(sign(sign(self.secret_key.encode(), short_date), self.region), "cv")
        signing_key = sign(signing_key, "request")
        signature = hmac.new(signing_key, string_to_sign.encode(), hashlib.sha256).hexdigest()
        authorization = (
            f"HMAC-SHA256 Credential={self.access_key}/{credential_scope}, "
            "SignedHeaders=content-type;host;x-content-sha256;x-date, "
            f"Signature={signature}"
        )
        return {
            "Content-Type": "application/json",
            "Host": host,
            "X-Date": date,
            "X-Content-Sha256": payload_hash,
            "Authorization": authorization,
        }

    async def _post(self, url: str, payload: dict) -> dict:
        if not url:
            raise RuntimeError(f"未配置{self.service_name} API 地址")
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        async with httpx.AsyncClient(timeout=45) as client:
            for attempt in range(10):
                response = await client.post(url, content=body, headers=self._headers(url, body))
                if response.status_code != 429:
                    break
                if attempt == 9:
                    raise RuntimeError(f"{self.service_name}当前并发额度已占满，自动等待重试后仍不可用")
                retry_after = response.headers.get("Retry-After", "")
                try:
                    delay = max(3.0, min(30.0, float(retry_after)))
                except ValueError:
                    delay = min(30.0, 3.0 * (attempt + 1))
                await asyncio.sleep(delay)

            try:
                result = response.json()
            except ValueError as exc:
                if response.is_error:
                    raise RuntimeError(f"{self.service_name} HTTP {response.status_code}：{response.text[:300]}") from exc
                raise RuntimeError(f"{self.service_name}返回了无法解析的响应") from exc

            if response.is_error:
                code = self._find_value(result, {"code", "Code"})
                message = self._find_value(result, {"message", "Message"})
                request_id = self._find_value(result, {"request_id", "RequestId", "RequestID"})
                suffix = f"（request_id: {request_id}）" if request_id else ""
                raise RuntimeError(
                    f"{self.service_name} HTTP {response.status_code}"
                    f"{f' / {code}' if code is not None else ''}：{message or '请求失败'}{suffix}"
                )
        code = self._find_value(result, {"code", "Code"})
        if code is not None and str(code) not in {"0", "10000"}:
            message = self._find_value(result, {"message", "Message"})
            request_id = self._find_value(result, {"request_id", "RequestId", "RequestID"})
            suffix = f"（request_id: {request_id}）" if request_id else ""
            raise RuntimeError(f"{self.service_name}返回错误 {code}：{message or '服务调用失败'}{suffix}")
        return result

    async def create_talking_video(self, image_url: str, audio_url: str) -> DigitalHumanTask:
        payload = {"req_key": self.req_key, "image_url": image_url, "audio_url": audio_url}
        result = await self._post(self.submit_url, payload)
        task_id = self._find_value(result, {"task_id", "taskId", "TaskId"})
        if not task_id:
            code = self._find_value(result, {"code", "Code"})
            message = self._find_value(result, {"message", "Message"})
            request_id = self._find_value(result, {"request_id", "RequestId", "RequestID"})
            raise RuntimeError(
                "OmniHuman 响应缺少 task_id"
                f"（code={code!s}, message={message or '无'}, request_id={request_id or '无'}）"
            )
        return DigitalHumanTask(task_id=str(task_id))

    async def get_task_status(self, task_id: str) -> DigitalHumanResult:
        result = await self._post(self.result_url, {"req_key": self.req_key, "task_id": task_id})
        data = self._find_business_data(result) or result
        status = str(data.get("status") or data.get("Status") or "processing").lower()
        if status in {"done", "success", "completed"}:
            raw_video_url = self._find_value(data, {"video_url", "videoUrl", "VideoUrl"})
            video_url = self._first_media_url(raw_video_url)
            if not video_url:
                return DigitalHumanResult(task_id, "failed", error="生成完成但响应缺少 video_url")
            return DigitalHumanResult(task_id, "ready", video_url)
        if status in {"failed", "error"}:
            message = self._find_value(data, {"message", "Message"}) or self._find_value(
                result, {"message", "Message"}
            )
            return DigitalHumanResult(task_id, "failed", error=str(message or "生成失败"))
        return DigitalHumanResult(task_id, "preparing")


async def wait_for_digital_human_task(
    provider: DigitalHumanProvider,
    task_id: str,
    timeout_seconds: float = 180,
    interval_seconds: float = 2,
) -> DigitalHumanResult:
    """轮询数字人任务并施加业务超时；超时和失败均由上层切换 Mock。"""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds
    while loop.time() < deadline:
        result = await provider.get_task_status(task_id)
        if result.status in {"ready", "failed"}:
            return result
        await asyncio.sleep(interval_seconds)
    raise TimeoutError(f"数字人任务 {task_id} 生成超时")
