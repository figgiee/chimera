"""
LM Studio service for Chimera RAG - Local LLM inference
"""

import logging
import httpx
from typing import AsyncGenerator, Optional

logger = logging.getLogger(__name__)


class LMStudioService:
    """Service for communicating with LM Studio."""

    def __init__(self, lm_studio_url: str = "http://localhost:1234"):
        self.lm_studio_url = lm_studio_url.rstrip("/")
        self.model = None
        self._last_health_ok = False

    async def check_health(self) -> bool:
        """Check if LM Studio is healthy via OpenAI-compatible endpoint."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.lm_studio_url}/v1/models")
                if response.status_code == 200:
                    data = response.json()
                    models = [m["id"] for m in data.get("data", [])]
                    if models:
                        self.model = models[0]
                    if not self._last_health_ok:
                        logger.info(f"LM Studio connected, model: {self.model}")
                    self._last_health_ok = True
                    return True
                self._last_health_ok = False
                return False
        except Exception as e:
            if self._last_health_ok:
                logger.warning(f"LM Studio became unreachable: {e}")
            self._last_health_ok = False
            return False

    async def get_models(self) -> list:
        """Get list of available models."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.lm_studio_url}/v1/models"
                )

                if response.status_code == 200:
                    data = response.json()
                    models = [m["id"] for m in data.get("data", [])]
                    logger.info(f"Available models: {models}")
                    return models

                return []

        except Exception as e:
            logger.error(f"Failed to get models: {e}")
            return []

    async def stream_chat(
        self,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> AsyncGenerator[str, None]:
        """Stream chat completion from LM Studio."""
        try:
            async with httpx.AsyncClient(timeout=300.0) as client:
                response = await client.post(
                    f"{self.lm_studio_url}/v1/chat/completions",
                    json={
                        "messages": [
                            {
                                "role": "user",
                                "content": prompt
                            }
                        ],
                        "temperature": temperature,
                        "max_tokens": max_tokens,
                        "stream": True
                    }
                )

                if response.status_code != 200:
                    logger.error(f"LM Studio error: {response.status_code}")
                    yield f"Error: LM Studio returned {response.status_code}"
                    return

                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        try:
                            import json
                            chunk_data = json.loads(line[6:])
                            delta = chunk_data["choices"][0].get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                yield content
                        except (json.JSONDecodeError, KeyError, IndexError):
                            continue

        except httpx.ConnectError:
            logger.error(f"Cannot connect to LM Studio at {self.lm_studio_url}")
            yield f"Error: Cannot connect to LM Studio at {self.lm_studio_url}"
        except Exception as e:
            logger.error(f"Chat streaming error: {e}")
            yield f"Error: {str(e)}"

    async def chat(
        self,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 2048
    ) -> str:
        """Get chat completion from LM Studio (non-streaming)."""
        try:
            async with httpx.AsyncClient(timeout=300.0) as client:
                response = await client.post(
                    f"{self.lm_studio_url}/v1/chat/completions",
                    json={
                        "messages": [
                            {
                                "role": "user",
                                "content": prompt
                            }
                        ],
                        "temperature": temperature,
                        "max_tokens": max_tokens,
                        "stream": False
                    }
                )

                if response.status_code != 200:
                    logger.error(f"LM Studio error: {response.status_code}")
                    return f"Error: LM Studio returned {response.status_code}"

                data = response.json()
                return data["choices"][0]["message"]["content"]

        except httpx.ConnectError:
            logger.error(f"Cannot connect to LM Studio")
            return "Error: Cannot connect to LM Studio"
        except Exception as e:
            logger.error(f"Chat error: {e}")
            return f"Error: {str(e)}"

    async def health_check_detailed(self) -> dict:
        """Get detailed health check."""
        try:
            is_healthy = await self.check_health()
            models = await self.get_models() if is_healthy else []

            return {
                "healthy": is_healthy,
                "url": self.lm_studio_url,
                "models": models,
                "message": "LM Studio is ready" if is_healthy else "LM Studio is not responding"
            }

        except Exception as e:
            return {
                "healthy": False,
                "url": self.lm_studio_url,
                "error": str(e),
                "message": "Failed to check LM Studio status"
            }
