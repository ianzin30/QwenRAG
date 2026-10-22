"""Turn coordination independent of transport. One accepted submission = one execution.

Ported from RAG-UFC ``presentation/chat/Turns.py`` with the same rules:
``begin`` registers the turn and its question atomically (duplicate ids and a
second running question are conflicts), ``run`` calls the engine once and maps
failures to public messages, and ``finish`` is idempotent: a stored result is
never followed by a second answer.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import logging
import os
import time
import traceback
import uuid
from pathlib import Path

from rag_ufc_core.errors import InputBudgetError, LLMConnectionError, LLMError, ProviderError
from rag_ufc_core.results import normalize_presentation, preserve_v2_fields

from ..persistence.conversations import build_timestamp_now, truncate_title
from ..persistence.store import Conflict, ConversationStore, PersistenceResult, check_available, find_chat
from ..settings import ChatSettings

logger = logging.getLogger("qwenrag.turns")
COMPLETED_STATES = {"answered", "partial", "casual", "abstained", "clarification_required"}
BACKEND_ROOT = Path(__file__).resolve().parents[1]
UNKNOWN_OUTCOME = ("Resultado remoto desconhecido. A pergunta não será repetida automaticamente. "
                   "Confira a conexão antes de fazer um novo envio.")


@dataclass(frozen=True)
class TurnContext:
    turn_id: str
    chat_id: str
    question: str
    history: list
    collection: list
    profile: dict


@dataclass
class TurnResult:
    state: str
    message: dict | None = None
    error: str | None = None
    metadata: dict | None = None


def safe_calls(calls):
    """Provider call metadata without prompts; endpoints stay server-side."""
    safe = []
    for c in calls if isinstance(calls, list) else []:
        if not isinstance(c, dict):
            continue
        safe.append({k: deepcopy(c[k]) for k in ('role', 'status', 'provider', 'logical_model', 'physical_model', 'endpoint',
                                                  'latency_seconds', 'structured_attempt', 'sent_parameters', 'observed',
                                                  'server_timings') if k in c})
    return {'provider_calls': safe, 'logical_calls': len(safe),
            'transport_attempts': sum((c.get('server_timings') or {}).get('transport_attempts', 1) for c in safe)}


class TurnCoordinator:
    def __init__(self, store: ConversationStore, chat: ChatSettings):
        self.store = store
        self.chat = chat

    def semantic_history(self, messages):
        """Only completed pairs and compatible legacy dialogue enter the prompt."""
        complete = {m.get('turn_id') for m in messages if m.get('role') == 'assistant' and m.get('turn_id')
                    and m.get('turn_state') in COMPLETED_STATES}
        known_legacy_error = 'Nao consegui gerar a resposta agora. Tente novamente em instantes.'
        history = []
        for index, message in enumerate(messages):
            if message.get('turn_id'):
                if message['turn_id'] not in complete:
                    continue
            elif message.get('content') == known_legacy_error:
                continue
            elif message.get('role') == 'user':
                following = messages[index + 1] if index + 1 < len(messages) else {}
                if (following.get('turn_id') or following.get('role') != 'assistant'
                        or following.get('content') == known_legacy_error or not str(following.get('content') or '').strip()):
                    continue
            elif message.get('role') == 'assistant':
                previous = messages[index - 1] if index else {}
                if previous.get('turn_id') or previous.get('role') != 'user':
                    continue
            if message.get('role') in {'user', 'assistant'} and str(message.get('content') or '').strip():
                history.append({'role': message['role'], 'content': message['content']})
        limit = self.chat.history_messages
        return history[-limit:] if limit else []

    def begin(self, chat_id, question, collection, profile, *, expected_revision, turn_id=None):
        identifier = turn_id or uuid.uuid4().hex
        context = None
        with self.store.lock:
            if identifier in self.store.active_turns:
                return None, PersistenceResult("conflict", error="Esta submissão já está em execução.")
            self.store.active_turns.add(identifier)

        def operation(state):
            nonlocal context
            chat = find_chat(state, chat_id)
            if any(t.get('turn_id') == identifier for t in chat.get('turns', [])):
                raise Conflict('Esta submissão já foi registrada. Nenhuma nova execução foi iniciada.')
            check_available(chat)
            if chat.get('revision', 0) != expected_revision:
                raise Conflict('A conversa mudou em outra aba. Atualize e envie novamente.')
            context = TurnContext(identifier, chat_id, question, self.semantic_history(chat['messages']),
                                  deepcopy(collection), deepcopy(profile))
            chat.setdefault('turns', []).append({
                'turn_id': identifier, 'state': 'running', 'owner_pid': os.getpid(), 'owner_token': self.store.process_token,
                'profile': deepcopy(profile), 'collection': deepcopy(collection), 'created_at': build_timestamp_now()})
            chat['messages'].append({'role': 'user', 'content': question, 'turn_id': identifier, 'turn_state': 'running'})
            if str(chat.get('title', '')).startswith(self.chat.default_title):
                chat['title'] = truncate_title(question, self.chat.title_max_chars, self.chat.default_title)
            chat['revision'] = chat.get('revision', 0) + 1
            chat['updated_at'] = build_timestamp_now()

        saved = self.store.mutate(operation)
        if not saved.ok:
            self.store.active_turns.discard(identifier)
            return None, saved
        return context, saved

    def run(self, service, context):
        started = time.perf_counter()
        try:
            trace = service.ask_question_with_trace(context.question, deepcopy(context.history))
            if not isinstance(trace, dict) or not isinstance(trace.get('answer_text'), str) or not trace['answer_text'].strip():
                raise ValueError('empty_response')
            state = trace.get('status', 'answered')
            if state not in COMPLETED_STATES | {'completed'}:
                raise ValueError('invalid_response_state')
            state = 'answered' if state == 'completed' else state
            message = {'role': 'assistant', 'content': trace['answer_text'].strip(), 'route': trace.get('route', 'retrieval'),
                       'resolved_question': trace.get('resolved_question', context.question), 'turn_id': context.turn_id,
                       'turn_state': state, 'profile': deepcopy(context.profile), 'collection': deepcopy(context.collection),
                       'sources': trace.get('sources', [])}
            preserve_v2_fields(trace, message)
            metadata = safe_calls(trace.get('provider_calls', []))
            message['execution'] = metadata
            return TurnResult(state, normalize_presentation(message), metadata=metadata)
        except Exception as exc:
            unknown = isinstance(exc, (TimeoutError, ConnectionError, LLMConnectionError))
            error = str(exc) if isinstance(exc, (LLMError, ProviderError)) else (
                'A resposta recebida estava vazia ou inválida.' if isinstance(exc, ValueError) else
                'Não foi possível concluir a resposta. Confira os serviços e envie uma nova pergunta '
                'quando estiverem disponíveis.')
            if getattr(exc, 'code', None) == InputBudgetError.code:
                error = exc.public_message
            if isinstance(exc, ProviderError) and str(exc).startswith('Invalid '):
                error = 'A saída estruturada do modelo não passou na validação após o reparo permitido.'
            if unknown:
                error = UNKNOWN_OUTCOME
            registry = getattr(getattr(service, '_v2', None), 'providers', None)
            metadata = safe_calls(getattr(registry, 'calls', []))
            metadata['error_type'] = type(exc).__name__
            metadata['error_origin'] = [
                {'file': str(Path(f.filename).relative_to(BACKEND_ROOT)), 'line': f.lineno, 'function': f.name}
                for f in traceback.extract_tb(exc.__traceback__) if Path(f.filename).is_relative_to(BACKEND_ROOT)]
            return TurnResult('unknown' if unknown else 'failed', error=error, metadata=metadata)
        finally:
            logger.info('turn_finished turn_id=%s chat_id=%s seconds=%.3f', context.turn_id, context.chat_id,
                        time.perf_counter() - started)

    def finish(self, context, result):
        def operation(state):
            chat = find_chat(state, context.chat_id)
            turn = next((t for t in chat.get('turns', []) if t['turn_id'] == context.turn_id), None)
            if turn is None:
                raise Conflict('Turno de origem não encontrado; resposta preservada somente nesta sessão.')
            if turn.get('state') in COMPLETED_STATES | {'failed'}:
                return  # Retry storage is idempotent, never append a second response.
            # The final profile includes the index the answer was retrieved from.
            turn.update(state=result.state, error=result.error, execution=result.metadata, profile=deepcopy(context.profile),
                        finished_at=build_timestamp_now())
            for message in chat['messages']:
                if message.get('turn_id') == context.turn_id:
                    message['turn_state'] = result.state
            if result.message and not any(m.get('turn_id') == context.turn_id and m.get('role') == 'assistant'
                                          for m in chat['messages']):
                chat['messages'].append(deepcopy(result.message))
            chat['revision'] = chat.get('revision', 0) + 1
            chat['updated_at'] = build_timestamp_now()

        saved = self.store.mutate(operation)
        if saved.ok:
            self.store.active_turns.discard(context.turn_id)
        return saved
