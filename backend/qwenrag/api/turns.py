"""POST /conversations/{id}/turns: begin → run → finish as server-sent events."""
from __future__ import annotations

import asyncio
from copy import deepcopy
import logging
import re

import anyio
from fastapi import APIRouter, Request
from pydantic import BaseModel
from rag_ufc_core.collections import normalize_collection_selection

from .. import catalog
from ..persistence import store as persistence
from ..persistence.conversations import build_timestamp_now
from ..workflows.progress import collection_progress, response_progress
from ..workflows.turns import TurnResult
from .conversations import ANSWER_STATES, assistant_dto, find_chat, load_state, presentation_context
from .errors import ApiError, from_persistence
from .events import EventLog, remember, sse_response
from .services import preparation_error

logger = logging.getLogger("qwenrag.api.turns")
router = APIRouter()

CLIENT_TURN_ID = re.compile(r"^[A-Za-z0-9_-]{8,80}$")
INTERRUPTED = "Execução interrompida; resultado desconhecido. Nenhuma chamada será repetida automaticamente."


class TurnInput(BaseModel):
    client_turn_id: str
    question: str
    model: str | None = None
    collection: list[str] | str | None = None


class TurnJob:
    def __init__(self, chat_id: str, log: EventLog):
        self.chat_id = chat_id
        self.log = log


def _replay(log: EventLog, chat, turn, context):
    """A client_turn_id that already ran is answered from storage, never executed again."""
    turn_id = turn["turn_id"]
    log.publish("turn.accepted", {"turn_id": turn_id, "user_message_id": f"{turn_id}-user"})
    message = next((m for m in chat["messages"] if m.get("turn_id") == turn_id and m.get("role") == "assistant"), None)
    if turn.get("state") in ANSWER_STATES and message:
        labels, ids = context
        log.publish("turn.completed", {"message": assistant_dto(message, turn=turn, model_labels=labels, document_ids=ids)},
                    final=True)
    else:
        outcome = "failed" if turn.get("state") == "failed" else "unknown"
        log.publish("turn.failed", {"outcome": outcome, "message": turn.get("error") or INTERRUPTED, "code": "replayed"},
                    final=True)


def _accept(app, chat_id: str, body: TurnInput):
    """Validate, persist the selection and begin the turn. Returns (context, model, collections)
    for a new turn, or (None, chat, turn) when this client_turn_id is already stored."""
    store, core = app.state.store, app.state.core
    chat = find_chat(load_state(app), chat_id)
    stored = next((t for t in chat.get("turns", []) if t.get("turn_id") == body.client_turn_id), None)
    if stored is not None:
        if stored.get("state") == "running":
            raise ApiError(409, "Esta submissão já está em execução.", "turn_running")
        return None, chat, stored

    question = (body.question or "").strip()
    if not question:
        raise ApiError(400, "Digite uma pergunta.", "empty_question")
    names = {option["model_name"] for option in core.model_options()}
    if body.model and body.model not in names:
        raise ApiError(400, "Modelo indisponível. Selecione um modelo da lista.", "model_unavailable")
    model = body.model or (chat.get("model_name") if chat.get("model_name") in names else core.default_model)
    available = catalog.available_collections(app.state.settings.collections_root)
    if not available:
        raise ApiError(409, "Nenhum documento disponível. Envie arquivos antes de perguntar.", "no_documents")
    collections = (normalize_collection_selection(body.collection) or normalize_collection_selection(chat.get("collection"))
                   or available[:1])
    if any(name not in available for name in collections):
        raise ApiError(400, "Coleção indisponível. Atualize a lista de arquivos.", "collection_unavailable")

    def select(state):
        target = persistence.find_chat(state, chat_id)
        persistence.check_available(target)
        if target.get("model_name") != model or normalize_collection_selection(target.get("collection")) != collections:
            target.update(model_name=model, collection=list(collections), updated_at=build_timestamp_now())
            target["revision"] = target.get("revision", 0) + 1

    selected = store.mutate(select)
    if not selected.ok:
        raise from_persistence(selected)
    revision = persistence.find_chat(selected.state, chat_id).get("revision", 0)
    profile = core.turn_profile(model)
    context, saved = app.state.turns.begin(chat_id, question, collections, profile,
                                           expected_revision=revision, turn_id=body.client_turn_id)
    if context is None:
        raise from_persistence(saved)
    return context, model, collections


def _finish(app, context, result, attempts=3):
    saved = None
    for _ in range(attempts):
        saved = app.state.turns.finish(context, result)
        if saved.ok or saved.status == "conflict":
            break
    return saved


def _execute(app, context, model, collections, log: EventLog):
    """Worker thread. The job outlives the HTTP connection: a closed tab never loses the answer."""
    result = None
    try:
        try:
            prepared = app.state.services.acquire(
                model, collections, context.profile["pipeline"]["pipeline_signature"],
                lambda payload: log.publish("turn.progress", collection_progress(payload)))
        except Exception as exc:
            logger.warning("turn_preparation_failed turn_id=%s error=%s", context.turn_id, type(exc).__name__)
            result = TurnResult("failed", error=preparation_error(exc), metadata={"error_type": type(exc).__name__})
        else:
            context.profile["index"] = deepcopy(prepared.diagnostics)
            with prepared.lock:
                service = prepared.service
                service.set_response_status_callback(lambda payload: log.publish("turn.progress", response_progress(payload)))
                try:
                    result = app.state.turns.run(service, context)
                finally:
                    service.set_response_status_callback(None)
    finally:
        result = result or TurnResult("unknown", error=INTERRUPTED)
        saved = _finish(app, context, result)
        if saved is None or not saved.ok:
            app.state.store.active_turns.discard(context.turn_id)
            log.publish("turn.failed", {"outcome": "unknown", "code": "storage_failed",
                                        "message": "A resposta foi gerada, mas não foi salva no histórico. "
                                        + ((saved.error if saved else "") or "")
                                        + " Nenhuma chamada será repetida automaticamente."}, final=True)
        elif result.message:
            chat = persistence.find_chat(saved.state, context.chat_id)
            turn = next((t for t in chat.get("turns", []) if t.get("turn_id") == context.turn_id), {})
            labels, ids = presentation_context(app)
            log.publish("turn.completed", {"message": assistant_dto(result.message, turn=turn, model_labels=labels,
                                                                    document_ids=ids)}, final=True)
        else:
            log.publish("turn.failed", {"outcome": "unknown" if result.state == "unknown" else "failed",
                                        "message": result.error or INTERRUPTED}, final=True)


@router.post("/conversations/{chat_id}/turns")
async def create_turn(request: Request, chat_id: str, body: TurnInput):
    app = request.app
    keep_alive = app.state.keep_alive_seconds
    if not CLIENT_TURN_ID.match(body.client_turn_id or ""):
        raise ApiError(400, "client_turn_id inválido.", "invalid_client_turn_id")
    job = app.state.turn_jobs.get(body.client_turn_id)
    if job is not None:
        if job.chat_id != chat_id:
            raise ApiError(409, "Esta submissão pertence a outra conversa.", "turn_conflict")
        return sse_response(job.log.follow(keep_alive))

    accepted = await anyio.to_thread.run_sync(_accept, app, chat_id, body)
    log = EventLog()
    if accepted[0] is None:
        _, chat, turn = accepted
        _replay(log, chat, turn, await anyio.to_thread.run_sync(presentation_context, app))
        return sse_response(log.follow(keep_alive))

    context, model, collections = accepted
    remember(app.state.turn_jobs, context.turn_id, TurnJob(chat_id, log))
    log.publish("turn.accepted", {"turn_id": context.turn_id, "user_message_id": f"{context.turn_id}-user"})
    task = asyncio.create_task(anyio.to_thread.run_sync(_execute, app, context, model, collections, log))
    app.state.background_tasks.add(task)
    task.add_done_callback(app.state.background_tasks.discard)
    return sse_response(log.follow(keep_alive))
