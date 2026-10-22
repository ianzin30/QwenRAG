"""Conversations and their messages as the frontend expects them (frontend/docs/INTEGRATION.md)."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel
from rag_ufc_core.collections import normalize_collection_selection
from rag_ufc_core.results import ANSWER_STATES, displayed_sources

from .. import catalog
from ..persistence import store as persistence
from ..persistence.conversations import create_session
from .errors import ApiError, from_persistence

router = APIRouter()

SOURCE_FIELDS = ("source_id", "evidence_id", "document_name", "chunk_kind", "section_title", "excerpt",
                 "relative_path", "provenance", "claim_ids", "focus_spans")
EXECUTION_FIELDS = ("logical_calls", "transport_attempts")


class ConversationInput(BaseModel):
    collection: list[str] | str | None = None
    model: str | None = None


def load_state(app):
    try:
        return app.state.store.load()
    except persistence.StorageError as exc:
        raise ApiError(503, str(exc), "storage_failed") from None


def find_chat(state, chat_id):
    chat = next((c for c in state["chat_sessions"] if c["id"] == chat_id), None)
    if chat is None:
        raise ApiError(404, "A conversa não existe mais. Atualize o histórico.", "conversation_not_found")
    return chat


def conversation_dto(chat):
    return {"id": chat["id"], "title": chat.get("title") or "",
            "updated_at": chat.get("updated_at") or chat.get("created_at") or "",
            "collection": normalize_collection_selection(chat.get("collection")), "model": chat.get("model_name")}


def _duration_ms(turn):
    try:
        started = datetime.fromisoformat(turn["created_at"])
        finished = datetime.fromisoformat(turn["finished_at"])
    except (KeyError, TypeError, ValueError):
        return None
    return max(0, int((finished - started).total_seconds() * 1000))


def _claims(message):
    claims = [{"claim_id": str(c.get("claim_id") or f"c{i + 1}"), "text": str(c.get("text") or ""),
               "evidence_ids": [str(e) for e in c.get("evidence_ids") or []]}
              for i, c in enumerate(message.get("claims") or []) if isinstance(c, dict)]
    content = str(message.get("content") or "")
    if claims and not content.startswith(claims[0]["text"]):
        # The UI renders claims instead of content; keep text the engine puts before them
        # (for example "Resposta parcial — falta: …") as a claim without citations.
        lead = content.split(claims[0]["text"], 1)[0].strip()
        if lead:
            claims.insert(0, {"claim_id": "preamble", "text": lead, "evidence_ids": []})
    return claims


def assistant_dto(message, *, turn=None, model_labels=None, document_ids=None, index=0):
    turn = turn or {}
    turn_id = message.get("turn_id")
    profile = message.get("profile") or {}
    model = (profile.get("llm") or {}).get("model")
    sources = displayed_sources(message) if message.get("route", "retrieval") == "retrieval" else []
    cited = []
    for source in sources:
        if not isinstance(source, dict):
            continue
        item = {k: source[k] for k in SOURCE_FIELDS if k in source}
        relative = str(source.get("relative_path") or "")
        if document_ids is not None and relative in document_ids:
            item["document_id"] = document_ids[relative]
        cited.append(item)
    dto = {
        "id": f"{turn_id}-assistant" if turn_id else f"legacy-{index}-assistant",
        "role": "assistant",
        "content": str(message.get("content") or ""),
        "route": message.get("route") or "retrieval",
        "created_at": turn.get("finished_at") or turn.get("created_at"),
        "collection": normalize_collection_selection(message.get("collection")),
        "claims": _claims(message),
        "source_warnings": list(message.get("source_warnings") or []),
    }
    # Legacy answers (no turn_id) keep the plain sources key.
    dto["cited_sources" if turn_id else "sources"] = cited
    if turn_id:
        dto.update(turn_id=turn_id, turn_state=message.get("turn_state") or turn.get("state") or "answered")
    if model:
        dto["profile"] = {"llm": {"model": model, "label": (model_labels or {}).get(model, model)}}
        pipeline = profile.get("pipeline") or {}
        if pipeline:
            # Which core release and pipeline produced this answer (traceability, no secrets).
            dto["profile"]["pipeline"] = {k: pipeline[k] for k in
                                          ("core_version", "pipeline_signature", "adoption_status") if k in pipeline}
    duration = _duration_ms(turn)
    if duration is not None:
        dto["duration_ms"] = duration
    execution = message.get("execution") or {}
    if isinstance(execution, dict) and execution:
        dto["execution"] = {k: execution[k] for k in EXECUTION_FIELDS if k in execution}
    return {k: v for k, v in dto.items() if v is not None}


def messages_dto(chat, *, model_labels=None, document_ids=None):
    turns = {t.get("turn_id"): t for t in chat.get("turns", [])}
    result = []
    for index, message in enumerate(chat.get("messages", [])):
        turn = turns.get(message.get("turn_id"), {}) if message.get("turn_id") else {}
        if message.get("role") == "assistant":
            dto = assistant_dto(message, turn=turn, model_labels=model_labels, document_ids=document_ids, index=index)
            if not turn and not message.get("turn_id"):
                dto["created_at"] = chat.get("created_at")
            result.append(dto)
            continue
        if message.get("role") != "user":
            continue
        turn_id = message.get("turn_id")
        dto = {"id": f"{turn_id}-user" if turn_id else f"legacy-{index}-user", "role": "user",
               "content": str(message.get("content") or ""), "created_at": turn.get("created_at") or chat.get("created_at")}
        if turn_id:
            dto["turn_id"] = turn_id
            # The stored turn state, so a reload can show failed/unknown/running turns.
            dto["turn_state"] = turn.get("state") or message.get("turn_state")
            if turn.get("state") in {"failed", "unknown"} and turn.get("error"):
                dto["error"] = turn["error"]
        result.append({k: v for k, v in dto.items() if v is not None})
    return result


def presentation_context(app):
    labels = {option["model_name"]: option["label"] for option in app.state.core.model_options()}
    ids = {d["relative_path"]: d["id"] for d in catalog.list_documents(app.state.settings.collections_root)}
    return labels, ids


def coerce_model(app, model):
    names = {option["model_name"] for option in app.state.core.model_options()}
    return model if model in names else app.state.core.default_model


@router.get("/conversations")
def list_conversations(request: Request):
    chats = load_state(request.app)["chat_sessions"]
    return sorted((conversation_dto(c) for c in chats), key=lambda c: c["updated_at"], reverse=True)


@router.post("/conversations", status_code=201)
def create_conversation(request: Request, body: ConversationInput):
    chat_settings = request.app.state.settings.chat
    created = []

    def operation(state):
        limit = chat_settings.max_sessions
        if len(state["chat_sessions"]) >= limit:
            raise persistence.Conflict(
                f"Você pode manter até {limit} chats ao mesmo tempo. Exclua uma conversa para criar outra.")
        chat = create_session(body.collection, coerce_model(request.app, body.model),
                              default_title=chat_settings.default_title,
                              existing_titles=[c.get("title") for c in state["chat_sessions"]])
        state["chat_sessions"].insert(0, chat)
        created.append(chat)

    result = request.app.state.store.mutate(operation)
    if not result.ok:
        raise from_persistence(result, not_found_code="conversation_limit")
    return conversation_dto(created[0])


@router.delete("/conversations/{chat_id}", status_code=204)
def delete_conversation(request: Request, chat_id: str):
    find_chat(load_state(request.app), chat_id)

    def operation(state):
        target = persistence.find_chat(state, chat_id)
        persistence.check_available(target)
        state["chat_sessions"].remove(target)

    result = request.app.state.store.mutate(operation)
    if not result.ok:
        raise from_persistence(result)
    return Response(status_code=204)


@router.get("/conversations/{chat_id}/messages")
def get_messages(request: Request, chat_id: str):
    chat = find_chat(load_state(request.app), chat_id)
    labels, ids = presentation_context(request.app)
    return messages_dto(chat, model_labels=labels, document_ids=ids)


__all__ = ["ANSWER_STATES", "assistant_dto", "find_chat", "load_state", "presentation_context", "router"]
