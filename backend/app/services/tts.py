import base64
import asyncio
import os
import subprocess
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
from uuid import uuid4

import httpx


@dataclass
class AudioResult:
    provider: str
    audio_url: Optional[str] = None
    browser_fallback: bool = False
    message: str = ""


class TTSProvider(ABC):
    name: str

    @abstractmethod
    async def synthesize(self, text: str, voice: Optional[str] = None) -> AudioResult:
        raise NotImplementedError


class MockTTSProvider(TTSProvider):
    name = "mock-browser"

    async def synthesize(self, text: str, voice: Optional[str] = None) -> AudioResult:
        return AudioResult(self.name, browser_fallback=True, message="使用浏览器中文语音合成")


class WindowsSapiTTSProvider(TTSProvider):
    """Windows 本地离线语音；失败时由接口继续降级为浏览器 speechSynthesis。"""

    name = "windows-sapi-local"

    def __init__(self, directory, public_base_url: str):
        self.directory = directory
        self.public_base_url = public_base_url.rstrip("/")
        directory.mkdir(parents=True, exist_ok=True)

    def _generate(self, text: str) -> str:
        filename = f"tts-{uuid4().hex}.wav"
        target = self.directory / filename
        encoded_text = base64.b64encode(text.encode("utf-8")).decode("ascii")
        env = os.environ.copy()
        env["DIGITAL_TEACHER_TTS_TEXT"] = encoded_text
        env["DIGITAL_TEACHER_TTS_OUTPUT"] = str(target)
        script = (
            "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Speech; "
            "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            "$v=$s.GetInstalledVoices() | Where-Object {$_.Enabled -and $_.VoiceInfo.Culture.Name -like 'zh-*'} | Select-Object -First 1; "
            "if($v){$s.SelectVoice($v.VoiceInfo.Name)}; "
            "$t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:DIGITAL_TEACHER_TTS_TEXT)); "
            "$s.Rate=0; $s.Volume=100; $s.SetOutputToWaveFile($env:DIGITAL_TEACHER_TTS_OUTPUT); "
            "$s.Speak($t); $s.Dispose()"
        )
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
            env=env,
            check=False,
            timeout=20,
            capture_output=True,
        )
        if result.returncode != 0 or not target.exists() or target.stat().st_size < 100:
            detail = result.stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"系统语音未生成有效音频：{detail or '输出文件为空'}")
        return f"{self.public_base_url}/media/audio/{filename}"

    async def synthesize(self, text: str, voice: Optional[str] = None) -> AudioResult:
        url = await asyncio.to_thread(self._generate, text)
        return AudioResult(self.name, audio_url=url, message="使用 Windows 本地中文语音")


class DoubaoTTSProvider(TTSProvider):
    name = "doubao-tts"
    endpoint = "https://openspeech.bytedance.com/api/v1/tts"

    def __init__(self, app_id: str, access_token: str, cluster: str, default_voice: str):
        self.app_id = app_id
        self.access_token = access_token
        self.cluster = cluster
        self.default_voice = default_voice

    async def synthesize(self, text: str, voice: Optional[str] = None) -> AudioResult:
        payload = {
            "app": {"appid": self.app_id, "token": self.access_token, "cluster": self.cluster},
            "user": {"uid": "digital-teacher"},
            "audio": {"voice_type": voice or self.default_voice, "encoding": "mp3", "speed_ratio": 1.0},
            "request": {"reqid": uuid4().hex, "text": text, "operation": "query"},
        }
        headers = {"Authorization": f"Bearer;{self.access_token}"}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(self.endpoint, json=payload, headers=headers)
            if response.is_error:
                try:
                    detail = response.json().get("message") or response.text
                except ValueError:
                    detail = response.text
                raise RuntimeError(f"豆包语音 HTTP {response.status_code}：{detail or '请求被拒绝'}")
            data = response.json()
        if data.get("code") != 3000 or not data.get("data"):
            raise RuntimeError(data.get("message", "豆包语音合成失败"))
        # data 为 base64 音频。第一版以内联 URL 返回，避免在 Provider 中耦合具体存储。
        base64.b64decode(data["data"], validate=True)
        return AudioResult(self.name, audio_url=f"data:audio/mp3;base64,{data['data']}")
