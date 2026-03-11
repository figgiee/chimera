"""
Chimera RAG Server - FastAPI application for local RAG with LM Studio
"""

import os
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional, List

import httpx
from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from db import Database, Document, Conversation
from embeddings import EmbeddingsService
from search import SearchService
from llm import LMStudioService

# Logging
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Services
db: Optional[Database] = None
embeddings_service: Optional[EmbeddingsService] = None
search_service: Optional[SearchService] = None
llm_service: Optional[LMStudioService] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize and cleanup resources."""
    global db, embeddings_service, search_service, llm_service

    logger.info("Starting Nexus RAG Server...")

    try:
        # Initialize database
        db = Database(
            host=os.getenv("POSTGRES_HOST", "localhost"),
            port=int(os.getenv("POSTGRES_PORT", 5432)),
            user=os.getenv("POSTGRES_USER", "nexus"),
            password=os.getenv("POSTGRES_PASSWORD", "nexus_secure_password"),
            database=os.getenv("POSTGRES_DB", "nexus_rag")
        )
        await db.connect()
        logger.info("Database connected")

        # Initialize embeddings service
        embeddings_service = EmbeddingsService(
            tei_url=os.getenv("TEI_URL", "http://localhost:8001")
        )
        logger.info("Embeddings service initialized")

        # Initialize search service
        search_service = SearchService(
            searxng_url=os.getenv("SEARXNG_URL", "http://localhost:8888")
        )
        logger.info("Search service initialized")

        # Initialize LM Studio service
        llm_service = LMStudioService(
            lm_studio_url=os.getenv("LM_STUDIO_URL", "http://localhost:1234")
        )
        logger.info("LM Studio service initialized")

        logger.info("✓ All services started successfully")

    except Exception as e:
        logger.error(f"Failed to initialize services: {e}")
        raise

    yield

    # Cleanup
    if db:
        await db.disconnect()
        logger.info("Database disconnected")


app = FastAPI(
    title="Chimera RAG",
    description="Local RAG pipeline with LM Studio",
    version="1.0.0",
    lifespan=lifespan
)


# Models
class ChatRequest(BaseModel):
    query: str
    conversation_id: str = "default"
    search_type: Optional[str] = "documents"  # "documents", "web", or "both"


class SearchRequest(BaseModel):
    query: str
    limit: int = 5
    type: str = "documents"  # "documents" or "web"
    threshold: float = 0.3  # similarity threshold


class ConversationStoreRequest(BaseModel):
    conversation_id: str
    role: str  # "user" or "assistant"
    content: str


class ConversationRecallRequest(BaseModel):
    query: str
    conversation_id: Optional[str] = None
    limit: int = 5


class DocumentUploadResponse(BaseModel):
    filename: str
    size: int
    status: str
    message: str


class HealthResponse(BaseModel):
    status: str
    timestamp: str
    services: dict


# Endpoints

@app.get("/health")
async def health() -> HealthResponse:
    """Health check endpoint."""
    services = {
        "database": "ok" if db and db.connected else "error",
        "embeddings": "ok" if embeddings_service else "error",
        "search": "ok" if search_service else "error",
        "llm_studio": "checking..."
    }

    # Check LM Studio connectivity
    if llm_service:
        try:
            await llm_service.check_health()
            services["llm_studio"] = "ok"
        except Exception as e:
            services["llm_studio"] = f"error: {str(e)}"

    return HealthResponse(
        status="ok",
        timestamp=datetime.now().isoformat(),
        services=services
    )


@app.post("/api/chat")
async def chat(request: ChatRequest):
    """Chat endpoint with RAG context."""
    if not all([db, embeddings_service, search_service, llm_service]):
        raise HTTPException(status_code=503, detail="Services not initialized")

    try:
        # Get or create conversation
        conv = await db.get_or_create_conversation(request.conversation_id)

        # Search for relevant context
        context = ""
        if request.search_type in ["documents", "both"]:
            doc_results = await search_service.search_documents(
                request.query,
                embeddings_service,
                db,
                limit=3
            )
            if doc_results:
                context += "## Documents\n"
                for result in doc_results:
                    context += f"- {result['source']}: {result['snippet']}\n"

        if request.search_type in ["web", "both"]:
            web_results = await search_service.search_web(request.query, limit=3)
            if web_results:
                context += "\n## Web Results\n"
                for result in web_results:
                    context += f"- {result['title']}: {result['snippet']}\n"

        # Generate response with LM Studio
        full_prompt = f"""You are a helpful AI assistant. Answer questions based on the provided context.

{f"Context:{context}" if context else ""}

User: {request.query}
Assistant:"""

        # Save user message
        await db.save_message(conv.id, "user", request.query)

        # Stream response
        async def generate():
            full_response = ""
            async for chunk in llm_service.stream_chat(full_prompt):
                full_response += chunk
                yield chunk

            # Save assistant message
            await db.save_message(conv.id, "assistant", full_response)

        return StreamingResponse(generate(), media_type="text/event-stream")

    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/search")
async def search(request: SearchRequest):
    """Search documents or web."""
    if not search_service:
        raise HTTPException(status_code=503, detail="Search service not available")

    try:
        if request.type == "documents":
            results = await search_service.search_documents(
                request.query,
                embeddings_service,
                db,
                limit=request.limit,
                threshold=request.threshold
            )
        elif request.type == "web":
            results = await search_service.search_web(request.query, limit=request.limit)
        else:
            raise HTTPException(status_code=400, detail="Invalid search type")

        return {"results": results, "query": request.query}

    except Exception as e:
        logger.error(f"Search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/documents/upload")
async def upload_document(file: UploadFile = File(...)):
    """Upload and index a document."""
    if not all([db, embeddings_service]):
        raise HTTPException(status_code=503, detail="Services not available")

    try:
        content = await file.read()

        # Save to storage
        filepath = f"/app/documents/{file.filename}"
        with open(filepath, "wb") as f:
            f.write(content)

        # Extract text based on file type
        text = await _extract_text(file.filename, content)

        # Chunk and embed
        chunks = _chunk_text(text, chunk_size=512, overlap=50)

        # Save to database
        doc = await db.create_document(
            filename=file.filename,
            source_type="upload",
            content=text
        )

        # Batch embed and save chunks
        batch_size = 32
        for batch_start in range(0, len(chunks), batch_size):
            batch = chunks[batch_start:batch_start + batch_size]
            embeddings = await embeddings_service.embed_batch(batch)
            for i, (chunk, embedding) in enumerate(zip(batch, embeddings)):
                await db.save_embedding(
                    document_id=doc.id,
                    content=chunk,
                    embedding=embedding,
                    chunk_index=batch_start + i
                )

        return DocumentUploadResponse(
            filename=file.filename,
            size=len(content),
            status="success",
            message=f"Document indexed with {len(chunks)} chunks"
        )

    except Exception as e:
        logger.error(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/conversations/{conversation_id}/history")
async def get_history(conversation_id: str):
    """Get conversation history."""
    if not db:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        conv = await db.get_or_create_conversation(conversation_id)
        messages = await db.get_messages(conv.id)

        return {
            "conversation_id": conversation_id,
            "messages": [
                {
                    "role": msg.role,
                    "content": msg.content,
                    "timestamp": msg.created_at.isoformat()
                }
                for msg in messages
            ]
        }
    except Exception as e:
        logger.error(f"History error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/conversations/{conversation_id}")
async def clear_conversation(conversation_id: str):
    """Clear conversation history."""
    if not db:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        await db.clear_conversation(conversation_id)
        return {"status": "cleared", "conversation_id": conversation_id}
    except Exception as e:
        logger.error(f"Clear error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/documents")
async def list_documents():
    """List all indexed documents."""
    if not db:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        docs = await db.list_documents()
        return {
            "documents": [
                {
                    "id": doc.id,
                    "filename": doc.filename,
                    "source_type": doc.source_type,
                    "created_at": doc.created_at.isoformat(),
                    "content_preview": doc.content[:200] + "..." if len(doc.content) > 200 else doc.content
                }
                for doc in docs
            ],
            "total": len(docs)
        }
    except Exception as e:
        logger.error(f"List documents error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/documents/{document_id}")
async def delete_document(document_id: str):
    """Delete a document and its embeddings."""
    if not db:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        await db.delete_document(document_id)
        return {"status": "deleted", "document_id": document_id}
    except Exception as e:
        logger.error(f"Delete document error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/conversations/store")
async def store_conversation(request: ConversationStoreRequest):
    """Store a conversation turn and embed it for future recall."""
    if not all([db, embeddings_service]):
        raise HTTPException(status_code=503, detail="Services not available")

    try:
        # Save as a message
        conv = await db.get_or_create_conversation(request.conversation_id)
        await db.save_message(conv.id, request.role, request.content)

        # Embed and store for semantic recall
        embedding = await embeddings_service.embed(request.content)
        await db.save_conversation_embedding(
            conversation_id=request.conversation_id,
            role=request.role,
            content=request.content,
            embedding=embedding
        )

        return {"status": "stored", "conversation_id": request.conversation_id}
    except Exception as e:
        logger.error(f"Store conversation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/conversations/recall")
async def recall_conversation(request: ConversationRecallRequest):
    """Recall relevant past conversation turns via semantic search."""
    if not all([db, embeddings_service]):
        raise HTTPException(status_code=503, detail="Services not available")

    try:
        query_embedding = await embeddings_service.embed(request.query)
        results = await db.search_conversation_embeddings(
            query_embedding,
            conversation_id=request.conversation_id,
            limit=request.limit
        )

        return {
            "query": request.query,
            "results": results
        }
    except Exception as e:
        logger.error(f"Recall conversation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Helper functions

async def _extract_text(filename: str, content: bytes) -> str:
    """Extract text from uploaded file."""
    import io

    if filename.endswith(".txt"):
        return content.decode("utf-8")
    elif filename.endswith(".md"):
        return content.decode("utf-8")
    elif filename.endswith(".pdf"):
        try:
            import PyPDF2
            pdf_reader = PyPDF2.PdfReader(io.BytesIO(content))
            text = "\n".join(page.extract_text() or "" for page in pdf_reader.pages)
            return text
        except Exception as e:
            logger.error(f"PDF extraction failed: {e}")
            return "[PDF extraction failed]"
    elif filename.endswith(".docx"):
        try:
            from docx import Document as DocxDocument
            doc = DocxDocument(io.BytesIO(content))
            text = "\n".join(para.text for para in doc.paragraphs)
            return text
        except Exception as e:
            logger.error(f"DOCX extraction failed: {e}")
            return "[DOCX extraction failed]"
    else:
        return content.decode("utf-8", errors="ignore")


def _chunk_text(text: str, chunk_size: int = 512, overlap: int = 50) -> List[str]:
    """Split text into overlapping chunks."""
    chunks = []
    for i in range(0, len(text), chunk_size - overlap):
        chunk = text[i:i + chunk_size]
        if chunk.strip():
            chunks.append(chunk)
    return chunks


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
