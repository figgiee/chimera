"""
Database module for Chimera RAG - PostgreSQL with pgvector
"""

import logging
from datetime import datetime
from typing import Optional, List

from sqlalchemy import create_engine, Column, String, DateTime, Integer, ARRAY
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.dialects.postgresql import UUID
from pgvector.sqlalchemy import Vector
import uuid

logger = logging.getLogger(__name__)

Base = declarative_base()


class DocumentModel(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    filename = Column(String, nullable=False)
    source_type = Column(String, default="upload")
    content = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class EmbeddingModel(Base):
    __tablename__ = "embeddings"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id = Column(String, nullable=False)
    content = Column(String, nullable=False)
    embedding = Column(Vector(384), nullable=False)  # all-MiniLM-L6-v2 uses 384 dims
    chunk_index = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow)


class ConversationModel(Base):
    __tablename__ = "conversations"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MessageModel(Base):
    __tablename__ = "messages"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String, nullable=False)
    role = Column(String, nullable=False)  # "user" or "assistant"
    content = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ConversationEmbeddingModel(Base):
    __tablename__ = "conversation_embeddings"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String, nullable=False)
    role = Column(String, nullable=False)
    content = Column(String, nullable=False)
    embedding = Column(Vector(384), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


# Python models
class Document:
    def __init__(self, id: str, filename: str, source_type: str, content: str, created_at: datetime):
        self.id = id
        self.filename = filename
        self.source_type = source_type
        self.content = content
        self.created_at = created_at


class Conversation:
    def __init__(self, id: str, conversation_id: str, created_at: datetime):
        self.id = id
        self.conversation_id = conversation_id
        self.created_at = created_at


class Message:
    def __init__(self, id: str, conversation_id: str, role: str, content: str, created_at: datetime):
        self.id = id
        self.conversation_id = conversation_id
        self.role = role
        self.content = content
        self.created_at = created_at


class Database:
    def __init__(self, host: str, port: int, user: str, password: str, database: str):
        self.host = host
        self.port = port
        self.user = user
        self.password = password
        self.database = database
        self.engine = None
        self.session_factory = None
        self.connected = False

    async def connect(self):
        """Connect to database and create tables."""
        try:
            # Connection string
            db_url = f"postgresql+asyncpg://{self.user}:{self.password}@{self.host}:{self.port}/{self.database}"

            # Create engine
            self.engine = create_async_engine(
                db_url,
                echo=False,
                pool_pre_ping=True,
                pool_size=5,
                max_overflow=10
            )

            # Create tables
            async with self.engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)

            # Create session factory
            self.session_factory = sessionmaker(
                self.engine,
                class_=AsyncSession,
                expire_on_commit=False
            )

            self.connected = True
            logger.info("Database connected successfully")

        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            raise

    async def disconnect(self):
        """Disconnect from database."""
        if self.engine:
            await self.engine.dispose()
            self.connected = False
            logger.info("Database disconnected")

    async def create_document(self, filename: str, source_type: str, content: str) -> Document:
        """Create a new document."""
        async with self.session_factory() as session:
            doc = DocumentModel(
                filename=filename,
                source_type=source_type,
                content=content
            )
            session.add(doc)
            await session.commit()

            return Document(
                id=doc.id,
                filename=doc.filename,
                source_type=doc.source_type,
                content=doc.content,
                created_at=doc.created_at
            )

    async def save_embedding(self, document_id: str, content: str, embedding: list, chunk_index: int = 0):
        """Save embedding to database."""
        async with self.session_factory() as session:
            emb = EmbeddingModel(
                document_id=document_id,
                content=content,
                embedding=embedding,
                chunk_index=chunk_index
            )
            session.add(emb)
            await session.commit()

    async def search_embeddings(self, query_embedding: list, limit: int = 5) -> List[dict]:
        """Search similar embeddings using pgvector."""
        async with self.session_factory() as session:
            from sqlalchemy import text

            embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"

            query = text("""
                SELECT id, document_id, content,
                       1 - (embedding <=> CAST(:query_embedding AS vector)) as similarity
                FROM embeddings
                ORDER BY embedding <=> CAST(:query_embedding AS vector)
                LIMIT :limit
            """)

            result = await session.execute(
                query,
                {
                    "query_embedding": embedding_str,
                    "limit": limit
                }
            )

            rows = result.fetchall()
            return [
                {
                    "id": row[0],
                    "document_id": row[1],
                    "content": row[2],
                    "similarity": float(row[3])
                }
                for row in rows
            ]

    async def get_or_create_conversation(self, conversation_id: str) -> Conversation:
        """Get or create a conversation."""
        async with self.session_factory() as session:
            from sqlalchemy import select

            stmt = select(ConversationModel).where(
                ConversationModel.conversation_id == conversation_id
            )
            result = await session.execute(stmt)
            conv = result.scalars().first()

            if not conv:
                conv = ConversationModel(conversation_id=conversation_id)
                session.add(conv)
                await session.commit()

            return Conversation(
                id=conv.id,
                conversation_id=conv.conversation_id,
                created_at=conv.created_at
            )

    async def save_message(self, conversation_id: str, role: str, content: str) -> Message:
        """Save message to conversation."""
        async with self.session_factory() as session:
            msg = MessageModel(
                conversation_id=conversation_id,
                role=role,
                content=content
            )
            session.add(msg)
            await session.commit()

            return Message(
                id=msg.id,
                conversation_id=msg.conversation_id,
                role=msg.role,
                content=msg.content,
                created_at=msg.created_at
            )

    async def get_messages(self, conversation_id: str, limit: int = 50) -> List[Message]:
        """Get messages from conversation."""
        async with self.session_factory() as session:
            from sqlalchemy import select

            stmt = select(MessageModel).where(
                MessageModel.conversation_id == conversation_id
            ).order_by(MessageModel.created_at).limit(limit)

            result = await session.execute(stmt)
            messages = result.scalars().all()

            return [
                Message(
                    id=msg.id,
                    conversation_id=msg.conversation_id,
                    role=msg.role,
                    content=msg.content,
                    created_at=msg.created_at
                )
                for msg in messages
            ]

    async def clear_conversation(self, conversation_id: str):
        """Clear all messages in conversation."""
        async with self.session_factory() as session:
            from sqlalchemy import delete

            stmt = delete(MessageModel).where(
                MessageModel.conversation_id == conversation_id
            )
            await session.execute(stmt)
            await session.commit()

    async def list_documents(self) -> List[Document]:
        """List all documents."""
        async with self.session_factory() as session:
            from sqlalchemy import select

            stmt = select(DocumentModel).order_by(DocumentModel.created_at.desc())
            result = await session.execute(stmt)
            docs = result.scalars().all()

            return [
                Document(
                    id=doc.id,
                    filename=doc.filename,
                    source_type=doc.source_type,
                    content=doc.content,
                    created_at=doc.created_at
                )
                for doc in docs
            ]

    async def delete_document(self, document_id: str):
        """Delete a document and its embeddings."""
        async with self.session_factory() as session:
            from sqlalchemy import delete

            # Delete embeddings first
            await session.execute(
                delete(EmbeddingModel).where(EmbeddingModel.document_id == document_id)
            )
            # Delete document
            await session.execute(
                delete(DocumentModel).where(DocumentModel.id == document_id)
            )
            await session.commit()

    async def save_conversation_embedding(
        self, conversation_id: str, role: str, content: str, embedding: list
    ):
        """Save an embedded conversation turn for semantic recall."""
        async with self.session_factory() as session:
            emb = ConversationEmbeddingModel(
                conversation_id=conversation_id,
                role=role,
                content=content,
                embedding=embedding
            )
            session.add(emb)
            await session.commit()

    async def search_conversation_embeddings(
        self, query_embedding: list, conversation_id: str = None, limit: int = 5
    ) -> List[dict]:
        """Search past conversation turns by semantic similarity."""
        async with self.session_factory() as session:
            from sqlalchemy import text

            embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"

            if conversation_id:
                query = text("""
                    SELECT id, conversation_id, role, content,
                           1 - (embedding <=> CAST(:query_embedding AS vector)) as similarity,
                           created_at
                    FROM conversation_embeddings
                    WHERE conversation_id = :conv_id
                    ORDER BY embedding <=> CAST(:query_embedding AS vector)
                    LIMIT :limit
                """)
                params = {
                    "query_embedding": embedding_str,
                    "conv_id": conversation_id,
                    "limit": limit
                }
            else:
                query = text("""
                    SELECT id, conversation_id, role, content,
                           1 - (embedding <=> CAST(:query_embedding AS vector)) as similarity,
                           created_at
                    FROM conversation_embeddings
                    ORDER BY embedding <=> CAST(:query_embedding AS vector)
                    LIMIT :limit
                """)
                params = {
                    "query_embedding": embedding_str,
                    "limit": limit
                }

            result = await session.execute(query, params)
            rows = result.fetchall()

            return [
                {
                    "id": row[0],
                    "conversation_id": row[1],
                    "role": row[2],
                    "content": row[3],
                    "similarity": float(row[4]),
                    "created_at": row[5].isoformat() if row[5] else None
                }
                for row in rows
            ]
