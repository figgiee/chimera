"""
Embeddings service for Chimera RAG - Text Embeddings Inference integration
"""

import logging
import httpx

logger = logging.getLogger(__name__)


class EmbeddingsService:
    """Service for generating embeddings via TEI."""

    def __init__(self, tei_url: str = "http://localhost:8001"):
        self.tei_url = tei_url.rstrip("/")
        self.client = None

    async def __aenter__(self):
        self.client = httpx.AsyncClient(timeout=30.0)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.client:
            await self.client.aclose()

    async def embed(self, text: str) -> list:
        """Generate embedding for text."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.tei_url}/embed",
                    json={"inputs": text}
                )

                if response.status_code != 200:
                    logger.error(f"TEI error: {response.status_code} - {response.text}")
                    raise Exception(f"TEI embedding failed: {response.status_code}")

                result = response.json()

                # TEI returns either a single embedding or a list
                if isinstance(result, list):
                    if isinstance(result[0], list):
                        return result[0]  # First embedding in batch
                    return result  # Direct embedding
                return result

        except httpx.ConnectError:
            logger.error(f"Failed to connect to TEI at {self.tei_url}")
            raise Exception("TEI service not available")
        except Exception as e:
            logger.error(f"Embedding error: {e}")
            raise

    async def embed_batch(self, texts: list) -> list:
        """Generate embeddings for multiple texts."""
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{self.tei_url}/embed",
                    json={"inputs": texts}
                )

                if response.status_code != 200:
                    logger.error(f"TEI error: {response.status_code}")
                    raise Exception("TEI batch embedding failed")

                return response.json()

        except Exception as e:
            logger.error(f"Batch embedding error: {e}")
            raise

    async def health_check(self) -> bool:
        """Check if TEI service is healthy."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.tei_url}/health")
                return response.status_code == 200
        except Exception:
            return False
