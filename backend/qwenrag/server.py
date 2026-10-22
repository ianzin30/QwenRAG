"""FastAPI application factory. Routes live under /api (frontend/docs/INTEGRATION.md)."""
from __future__ import annotations

from fastapi import FastAPI

from .api import conversations, library, turns, uploads
from .api.errors import ApiError, api_error_handler
from .api.services import ServicePool
from .core_runtime import CoreRuntime
from .persistence.store import ConversationStore
from .settings import AppSettings
from .workflows.turns import TurnCoordinator

KEEP_ALIVE_SECONDS = 15.0


def create_app(settings: AppSettings | None = None, *, core: CoreRuntime | None = None, service_factory=None,
               upload_service_factory=None, keep_alive_seconds: float = KEEP_ALIVE_SECONDS) -> FastAPI:
    """Factories are injectable so tests never load models or touch the network.

    Building the app verifies the core release (CoreRuntime): a divergent or
    unpinned pipeline stops startup unless explicitly allowed in the config.
    """
    settings = settings or AppSettings.load()
    core = core or CoreRuntime(settings)
    store = ConversationStore(settings.conversations_path)

    def default_uploads():
        from rag_ufc_core.LocalUploads import LocalUploadService
        return LocalUploadService(settings.collections_root)

    app = FastAPI(title="QwenRAG API", docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    app.state.settings = settings
    app.state.core = core
    app.state.store = store
    app.state.turns = TurnCoordinator(store, settings.chat)
    app.state.services = ServicePool(service_factory or core.create_service)
    app.state.upload_service_factory = upload_service_factory or default_uploads
    app.state.keep_alive_seconds = keep_alive_seconds
    app.state.turn_jobs = {}
    app.state.upload_jobs = {}
    app.state.background_tasks = set()
    app.add_exception_handler(ApiError, api_error_handler)
    for module in (library, conversations, turns, uploads):
        app.include_router(module.router, prefix="/api")
    return app
