"""Prepared RAGService instances shared across requests."""
from __future__ import annotations

from copy import deepcopy
import threading

from rag_ufc_core.errors import LLMError, ProviderError

PREPARATION_FAILED = ("Não foi possível preparar o modelo ou a coleção. "
                      "Confira o índice, o serviço de embeddings e a configuração.")


class PreparedService:
    def __init__(self, service, diagnostics):
        self.service = service
        self.diagnostics = diagnostics
        # RAGService keeps per-call state (callbacks, provider call log): one turn at a time.
        self.lock = threading.Lock()


class ServicePool:
    def __init__(self, factory):
        self._factory = factory
        self._services: dict[tuple, PreparedService] = {}
        self._lock = threading.Lock()

    def invalidate(self):
        """Documents changed: the next turn reloads the collection (fingerprinted cache)."""
        with self._lock:
            self._services.clear()

    def prepared_indexes(self) -> list[dict]:
        with self._lock:
            return [{"model": key[1], "collections": list(key[2]),
                     "index_fingerprint": prepared.diagnostics.get("fingerprint"),
                     "cache_hit": prepared.diagnostics.get("cache_hit")}
                    for key, prepared in self._services.items()]

    def acquire(self, model, collections, pipeline_signature, on_progress=None) -> PreparedService:
        """Model check, collection load (or index build) and readiness check, once per key."""
        identity = (pipeline_signature, model, tuple(collections))
        with self._lock:
            prepared = self._services.get(identity)
            if prepared is not None:
                return prepared
            service = self._factory(model_name=model)
            service.set_collection_progress_callback(on_progress)
            try:
                service.check_model_ready()
                service.load_collection(list(collections))
                service.check_ready()
            finally:
                service.set_collection_progress_callback(None)
            diagnostics = deepcopy(getattr(getattr(service, "_v2", None), "load_diagnostics", {}) or {})
            prepared = PreparedService(service, diagnostics)
            self._services[identity] = prepared
            return prepared


def preparation_error(exc) -> str:
    if isinstance(exc, (LLMError, ProviderError)):
        return str(exc)
    return PREPARATION_FAILED
