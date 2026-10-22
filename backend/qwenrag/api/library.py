"""Configuration, collections and documents. Document ids are opaque; paths stay server-side."""
from __future__ import annotations

from fastapi import APIRouter, Request, Response
from fastapi.responses import PlainTextResponse

from .. import catalog
from .errors import ApiError

router = APIRouter()
NOT_FOUND = "Documento não encontrado. Talvez ele já tenha sido removido."


def collections_root(request: Request):
    return request.app.state.settings.collections_root


@router.get("/config")
def get_config(request: Request):
    settings = request.app.state.settings
    return {
        "models": request.app.state.core.model_options(),
        "upload_types": list(catalog.UPLOAD_FILE_TYPES),
        "max_upload_bytes": settings.max_upload_bytes,
        "excerpt_chars": settings.chat.excerpt_chars,
        "title_max_chars": settings.chat.title_max_chars,
        "features": {"drive_import": False, "cancel_turn": False},
    }


@router.get("/collections")
def get_collections(request: Request):
    documents = catalog.scan(collections_root(request))
    names = catalog.available_collections(collections_root(request))
    return [{"name": name, "document_count": sum(1 for d in documents if d["collection"] == name)} for name in names]


@router.get("/documents")
def get_documents(request: Request, collection: str | None = None):
    documents = catalog.list_documents(collections_root(request))
    return [d for d in documents if collection is None or d["collection"] == collection]


@router.get("/documents/{identifier}/content")
def get_document_content(request: Request, identifier: str):
    root = collections_root(request)
    document = catalog.find_document(root, identifier)
    if document is None:
        raise ApiError(404, NOT_FOUND, "document_not_found")
    try:
        text = catalog.resolve_document_path(document, root).read_text(encoding="utf-8")
    except (OSError, catalog.DocumentError):
        raise ApiError(404, NOT_FOUND, "document_not_found") from None
    return PlainTextResponse(text, media_type="text/markdown; charset=utf-8")


@router.delete("/documents/{identifier}", status_code=204)
def delete_document(request: Request, identifier: str):
    root = collections_root(request)
    document = catalog.find_document(root, identifier)
    if document is None:
        raise ApiError(404, NOT_FOUND, "document_not_found")
    try:
        catalog.delete_document_files(document, root)
    except catalog.DocumentError as exc:
        raise ApiError(409, f"Não foi possível excluir o arquivo: {exc}", "document_delete_failed") from None
    request.app.state.services.invalidate()
    return Response(status_code=204)


@router.get("/diagnostics/pipeline")
def get_pipeline_diagnostics(request: Request):
    """Which core release and effective pipeline this server runs (no endpoints or secrets)."""
    return request.app.state.core.diagnostics(request.app.state.services.prepared_indexes())
