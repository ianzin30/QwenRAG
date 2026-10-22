"""FastAPI application factory. Routes live under /api (frontend/docs/INTEGRATION.md)."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

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
    _serve_frontend(app, settings)
    return app


class FrontendFiles(StaticFiles):
    """The built UI. index.html must be revalidated so a rebuild is picked up on the next
    load; assets have content hashes in their names and may be cached."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.headers.get("content-type", "").startswith("text/html"):
            response.headers["Cache-Control"] = "no-cache"
        return response


def _serve_frontend(app: FastAPI, settings: AppSettings) -> None:
    """One URL for users: the built React app at "/" (``npm run build``), the API under /api."""
    if (settings.frontend_dist / "index.html").exists():
        app.mount("/", FrontendFiles(directory=settings.frontend_dist, html=True), name="frontend")
        return

    @app.get("/", include_in_schema=False)
    def frontend_not_built():
        return HTMLResponse(
            "<!doctype html><meta charset=utf-8><title>QwenRAG API</title>"
            "<body style='font-family:sans-serif;max-width:40rem;margin:3rem auto'>"
            "<h1>QwenRAG API</h1><p>A API está rodando em <code>/api</code> "
            "(<a href='/api/docs'>documentação</a>, <a href='/api/diagnostics/pipeline'>diagnóstico</a>).</p>"
            "<p>A interface ainda não foi compilada. Rode <code>npm run build</code> em <code>frontend/</code> "
            "e reinicie o backend, ou use o servidor de desenvolvimento (<code>npm run dev</code>).</p></body>"
        )
