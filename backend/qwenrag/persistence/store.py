"""Transactional JSON conversation store (ported from RAG-UFC chat_sessions.Storage).

One file holds every conversation. Each mutation reads the latest state under a
thread lock plus an interprocess ``fcntl`` lock, applies one operation, bumps
revisions and replaces the file atomically. A turn left ``running`` by a process
that no longer exists is marked ``unknown`` on the next read: its remote outcome
is unknown and it is never re-executed.

Limits (see docs/architecture.md): one host, a local filesystem with ``fcntl``,
and one API worker owning running turns. Not a multi-user database.
"""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass
import fcntl
import json
import os
from pathlib import Path
import tempfile
import threading
import uuid

TURN_STATES = {"running", "answered", "partial", "casual", "abstained", "clarification_required", "unknown", "failed"}
INTERRUPTED = "Resultado desconhecido após interrupção. Nenhuma chamada foi repetida."


class StorageError(RuntimeError):
    pass


class Conflict(StorageError):
    pass


@dataclass
class PersistenceResult:
    status: str
    state: dict | None = None
    error: str | None = None

    @property
    def ok(self):
        return self.status == "saved"


def empty_state():
    return {"schema_version": 2, "revision": 0, "chat_sessions": [], "next_chat_session_id": 1}


def find_chat(state, chat_id):
    for chat in state["chat_sessions"]:
        if chat["id"] == chat_id:
            return chat
    raise Conflict("A conversa não existe mais. Atualize o histórico.")


def check_available(chat):
    if any(t.get("state") == "running" for t in chat.get("turns", [])):
        raise Conflict("Esta conversa já tem uma pergunta em execução em outra aba.")


class ConversationStore:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.RLock()
        self.process_token = uuid.uuid4().hex
        self.active_turns: set[str] = set()

    def _owner_alive(self, turn):
        if turn.get("owner_pid") == os.getpid():
            return turn.get("owner_token") == self.process_token and turn.get("turn_id") in self.active_turns
        try:
            pid = int(turn.get("owner_pid", 0))
            if pid <= 0:
                return False
            os.kill(pid, 0)
            return True
        except (ValueError, TypeError, ProcessLookupError):
            return False
        except PermissionError:
            return True

    def _read(self):
        if not self.path.exists():
            return empty_state()
        try:
            state = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(state, dict) or not isinstance(state.get("chat_sessions"), list):
                raise ValueError()
            if state.get("schema_version", 1) not in (1, 2):
                raise ValueError()
            for chat in state["chat_sessions"]:
                if not isinstance(chat, dict) or not isinstance(chat.get("id"), str) or not isinstance(chat.get("messages", []), list):
                    raise ValueError()
                chat.setdefault("revision", 0)
                chat.setdefault("turns", [])
                if not isinstance(chat["turns"], list):
                    raise ValueError()
                for turn in chat["turns"]:
                    if not isinstance(turn, dict) or not isinstance(turn.get("turn_id"), str) or turn.get("state") not in TURN_STATES:
                        raise ValueError()
                    if turn.get("state") == "running" and not self._owner_alive(turn):
                        turn.update(state="unknown", error=INTERRUPTED)
            state.setdefault("revision", 0)
            state.setdefault("next_chat_session_id", 1)
            if not isinstance(state["revision"], int) or not isinstance(state["next_chat_session_id"], int):
                raise ValueError()
            return state
        except (OSError, ValueError, TypeError, KeyError):
            raise StorageError("Não foi possível ler o histórico. Preserve o arquivo e restaure um backup antes de continuar; nenhum dado foi substituído.") from None

    @contextmanager
    def _locked(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.lock:
            with self.path.with_name(self.path.name + ".lock").open("a") as lock:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

    def _write(self, state):
        if self.path.exists():
            old = json.loads(self.path.read_text(encoding="utf-8"))
            if old.get("schema_version", 1) == 1:
                backup = self.path.with_name(self.path.name + ".v1.bak")
                if not backup.exists():
                    with backup.open("x", encoding="utf-8") as f:
                        f.write(self.path.read_text(encoding="utf-8"))
                        f.flush()
                        os.fsync(f.fileno())
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent,
                                             prefix=self.path.name + ".", suffix=".tmp", delete=False) as f:
                temporary = f.name
                json.dump(state, f, ensure_ascii=False, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(temporary, self.path)
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)

    def load(self):
        if not self.path.exists():
            return empty_state()
        try:
            with self._locked():
                return self._read()
        except StorageError:
            raise
        except OSError:
            raise StorageError("Não foi possível acessar o histórico. Confira as permissões; nenhum dado foi substituído.") from None

    def mutate(self, operation):
        """Read, validate and mutate the latest state under one interprocess lock."""
        try:
            with self._locked():
                state = self._read()
                updated = deepcopy(state)
                operation(updated)
                updated["schema_version"] = 2
                updated["revision"] = state["revision"] + 1
                self._write(updated)
            return PersistenceResult("saved", updated)
        except Conflict as exc:
            return PersistenceResult("conflict", error=str(exc))
        except StorageError as exc:
            return PersistenceResult("failed", error=str(exc))
        except Exception:
            return PersistenceResult("failed", error="Não foi possível salvar o histórico. Confira espaço e permissão de escrita.")
