"""
Search service for Chimera RAG - Document and web search
"""

import logging
import httpx
from typing import List, Optional

logger = logging.getLogger(__name__)


class SearchService:
    """Service for searching documents and web."""

    def __init__(self, searxng_url: str = "http://localhost:8888"):
        self.searxng_url = searxng_url.rstrip("/")

    async def search_documents(
        self,
        query: str,
        embeddings_service,
        db,
        limit: int = 5,
        threshold: float = 0.3
    ) -> List[dict]:
        """Search documents using vector embeddings."""
        try:
            # Get query embedding
            query_embedding = await embeddings_service.embed(query)

            # Search in database
            results = await db.search_embeddings(query_embedding, limit=limit)

            # Return formatted results
            return [
                {
                    "source": result.get("document_id", "Document"),
                    "snippet": result["content"][:200] + "..." if len(result["content"]) > 200 else result["content"],
                    "similarity": result["similarity"],
                    "full_content": result["content"]
                }
                for result in results
                if result["similarity"] > threshold
            ]

        except Exception as e:
            logger.error(f"Document search error: {e}")
            return []

    async def search_web(self, query: str, limit: int = 5) -> List[dict]:
        """Search the web via SearXNG."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.searxng_url}/search",
                    params={"q": query, "format": "json", "pageno": 1}
                )
                response.raise_for_status()
                data = response.json()

                results = []
                for item in data.get("results", [])[:limit]:
                    results.append({
                        "title": item.get("title", ""),
                        "url": item.get("url", ""),
                        "snippet": item.get("content", ""),
                        "engine": item.get("engine", "")
                    })
                return results

        except Exception as e:
            logger.error(f"Web search error: {e}")
            return []

    async def health_check(self) -> bool:
        """Check if SearxNG is healthy."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.searxng_url}/")
                return response.status_code == 200
        except:
            return False
