import json
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app import models, schemas
from app.claude import MODELS, run_turn
from app.config import settings
from app.db import Base, SessionLocal, engine, get_db

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Dev convenience: create tables on startup. Swap for Alembic migrations later.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="video2text-demo API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _get_conversation(db: Session, conversation_id: int) -> models.Conversation:
    conversation = db.get(models.Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "ok"}


@app.get("/api/models")
def list_models():
    return {"models": MODELS, "default": settings.claude_default_model}


@app.get("/api/conversations", response_model=list[schemas.ConversationRead])
def list_conversations(db: Session = Depends(get_db)):
    stmt = select(models.Conversation).order_by(models.Conversation.updated_at.desc())
    return db.scalars(stmt).all()


@app.post("/api/conversations", response_model=schemas.ConversationRead, status_code=201)
def create_conversation(payload: schemas.ConversationCreate, db: Session = Depends(get_db)):
    conversation = models.Conversation(model=payload.model or settings.claude_default_model)
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


@app.get("/api/conversations/{conversation_id}", response_model=schemas.ConversationDetail)
def get_conversation(conversation_id: int, db: Session = Depends(get_db)):
    return _get_conversation(db, conversation_id)


@app.patch("/api/conversations/{conversation_id}", response_model=schemas.ConversationRead)
def update_conversation(
    conversation_id: int, payload: schemas.ConversationUpdate, db: Session = Depends(get_db)
):
    conversation = _get_conversation(db, conversation_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(conversation, field, value)
    db.commit()
    db.refresh(conversation)
    return conversation


@app.delete("/api/conversations/{conversation_id}", status_code=204)
def delete_conversation(conversation_id: int, db: Session = Depends(get_db)):
    db.delete(_get_conversation(db, conversation_id))
    db.commit()


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def _append_block(blocks: list[dict], event: dict) -> None:
    """Fold a streamed event into the assistant message's stored blocks."""
    if event["type"] == "text":
        if blocks and blocks[-1]["type"] == "text" and not blocks[-1].get("closed"):
            blocks[-1]["text"] += event["text"]
        else:
            blocks.append({"type": "text", "text": event["text"]})
    elif event["type"] == "message_start":
        if blocks and blocks[-1]["type"] == "text":
            blocks[-1]["closed"] = True
    elif event["type"] in ("tool_use", "tool_result"):
        blocks.append({k: v for k, v in event.items()})


@app.post("/api/conversations/{conversation_id}/messages")
def send_message(conversation_id: int, payload: schemas.ChatRequest, db: Session = Depends(get_db)):
    conversation = _get_conversation(db, conversation_id)

    if not conversation.messages:
        conversation.title = payload.content.strip().splitlines()[0][:80] or "New chat"
    db.add(
        models.Message(
            conversation_id=conversation.id,
            role="user",
            blocks=[{"type": "text", "text": payload.content}],
        )
    )
    db.commit()

    model, resume = conversation.model, conversation.claude_session_id

    async def stream():
        blocks: list[dict] = []
        session_id, cost = resume, None
        try:
            async for event in run_turn(payload.content, model, resume):
                if event["type"] == "session":
                    session_id = event["session_id"] or session_id
                    continue
                if event["type"] == "result":
                    session_id = event["session_id"] or session_id
                    cost = event["cost_usd"]
                    if event["is_error"]:
                        blocks.append({"type": "error", "text": event["result"] or event["subtype"]})
                _append_block(blocks, event)
                yield _sse(event)
        except Exception as exc:  # surface SDK/CLI failures to the UI
            logger.exception("Claude turn failed")
            # The SDK also raises after an error result; don't report the same failure twice.
            if not any(b["type"] == "error" for b in blocks):
                error = {"type": "error", "text": str(exc)}
                blocks.append(error)
                yield _sse(error)
        finally:
            # Runs on completion, error, and client abort (Stop button), so partial replies are kept.
            with SessionLocal() as session:
                session.add(
                    models.Message(
                        conversation_id=conversation_id,
                        role="assistant",
                        blocks=[{k: v for k, v in b.items() if k != "closed"} for b in blocks],
                        cost_usd=cost,
                    )
                )
                convo = session.get(models.Conversation, conversation_id)
                # Only resume from sessions that actually produced output; a turn that failed
                # before Claude responded may not have a transcript on disk.
                if convo is not None and any(b["type"] != "error" for b in blocks):
                    convo.claude_session_id = session_id
                session.commit()
        yield _sse({"type": "done"})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
