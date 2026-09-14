from abc import ABC, abstractmethod
from uuid import uuid4

from .digital_human import (
    DigitalHumanResult,
    DigitalHumanTask,
    VolcengineOmniHumanProvider,
)


class IdleVideoProvider(ABC):
    """把教师照片转换为可循环播放的自然待机视频。"""

    name: str

    @abstractmethod
    async def create_idle_video(self, image_url: str, prompt: str) -> DigitalHumanTask:
        raise NotImplementedError

    @abstractmethod
    async def get_task_status(self, task_id: str) -> DigitalHumanResult:
        raise NotImplementedError


class MockIdleVideoProvider(IdleVideoProvider):
    name = "mock-css-idle"

    async def create_idle_video(self, image_url: str, prompt: str = "") -> DigitalHumanTask:
        return DigitalHumanTask(task_id=f"mock-idle-{uuid4().hex}", status="ready")

    async def get_task_status(self, task_id: str) -> DigitalHumanResult:
        return DigitalHumanResult(task_id=task_id, status="ready")


class VolcengineJimengIdleVideoProvider(IdleVideoProvider):
    """即梦图生视频 3.0 Provider，用于生成眨眼、呼吸等自然待机动作。"""

    name = "volcengine-jimeng-i2v-v3"
    req_key = "jimeng_i2v_first_v30"

    def __init__(
        self,
        access_key: str,
        secret_key: str,
        submit_url: str,
        result_url: str,
        region: str,
        frames: int = 121,
    ):
        self.frames = frames
        self.client = VolcengineOmniHumanProvider(
            access_key,
            secret_key,
            submit_url,
            result_url,
            region,
            service_name="即梦待机动画",
        )
        self.client.req_key = self.req_key

    async def create_idle_video(self, image_url: str, prompt: str) -> DigitalHumanTask:
        payload = {
            "req_key": self.req_key,
            "image_urls": [image_url],
            "prompt": prompt,
            "seed": -1,
            "frames": self.frames,
        }
        result = await self.client._post(self.client.submit_url, payload)
        task_id = self.client._find_value(result, {"task_id", "taskId", "TaskId"})
        if not task_id:
            code = self.client._find_value(result, {"code", "Code"})
            message = self.client._find_value(result, {"message", "Message"})
            request_id = self.client._find_value(
                result, {"request_id", "RequestId", "RequestID"}
            )
            raise RuntimeError(
                "即梦待机动画响应缺少 task_id"
                f"（code={code!s}, message={message or '无'}, request_id={request_id or '无'}）"
            )
        return DigitalHumanTask(task_id=str(task_id))

    async def get_task_status(self, task_id: str) -> DigitalHumanResult:
        return await self.client.get_task_status(task_id)
