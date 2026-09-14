import shutil
from io import BytesIO
from abc import ABC, abstractmethod
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4


class MediaStore(ABC):
    name: str
    @abstractmethod
    def save(self, stream: BinaryIO, suffix: str, content_type: str = "application/octet-stream") -> str:
        """保存媒体并返回可通过 HTTP 访问的 URL。"""

    def save_bytes(self, data: bytes, suffix: str, content_type: str) -> str:
        return self.save(BytesIO(data), suffix, content_type)


class LocalMediaStore(MediaStore):
    """仅供本地演示；返回本机 URL，不能直接提交给公网数字人服务。"""

    name = "local"

    def __init__(self, directory: Path, public_base_url: str):
        self.directory = directory
        self.public_base_url = public_base_url.rstrip("/")
        directory.mkdir(parents=True, exist_ok=True)

    def save(self, stream: BinaryIO, suffix: str, content_type: str = "application/octet-stream") -> str:
        name = f"{uuid4().hex}{suffix.lower()}"
        target = self.directory / name
        with target.open("wb") as output:
            shutil.copyfileobj(stream, output)
        return f"{self.public_base_url}/media/uploads/{name}"


class TOSMediaStore(MediaStore):
    """火山 TOS 私有桶实现，返回有时效的 GET 预签名 URL。"""

    name = "tos"

    def __init__(
        self,
        access_key: str,
        secret_key: str,
        endpoint: str,
        region: str,
        bucket: str,
        expires_seconds: int = 3600,
    ):
        import tos

        self.tos = tos
        self.client = tos.TosClientV2(access_key, secret_key, endpoint, region, enable_crc=True)
        self.bucket = bucket
        self.expires_seconds = expires_seconds

    def save(self, stream: BinaryIO, suffix: str, content_type: str = "application/octet-stream") -> str:
        key = f"digital-teacher/{uuid4().hex}{suffix.lower()}"
        self.client.put_object(self.bucket, key, content=stream, content_type=content_type)
        result = self.client.pre_signed_url(
            self.tos.HttpMethodType.Http_Method_Get,
            self.bucket,
            key,
            expires=self.expires_seconds,
        )
        return result.signed_url
