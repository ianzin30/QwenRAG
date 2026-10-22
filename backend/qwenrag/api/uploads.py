"""POST /uploads + GET /uploads/{job_id}/events over the core LocalUploadService."""
from __future__ import annotations

import asyncio
from copy import deepcopy
import logging
from pathlib import Path
import uuid

import anyio
from fastapi import APIRouter, File, Form, Request, UploadFile

from rag_ufc_core.collections import UPLOAD_COLLECTION_NAME

from ..catalog import list_documents
from .errors import ApiError
from .events import EventLog, remember, sse_response

logger = logging.getLogger("qwenrag.api.uploads")
router = APIRouter()

# Byte transfer is the first 30 % on the client (XHR); server phases fill the rest.
PHASE_PERCENT = {"queued": 30, "extracting": 60, "done": 100, "skipped": 100, "error": 100}


class UploadedBytes:
    """The two members LocalUploadService reads from an uploaded file."""

    def __init__(self, name: str, data: bytes):
        self.name = name
        self._data = data

    def getvalue(self) -> bytes:
        return self._data


class UploadJob:
    def __init__(self, log: EventLog, names: list[str]):
        self.log = log
        self.files = [{"file_name": name, "phase": "queued", "percent": PHASE_PERCENT["queued"]} for name in names]

    def update(self, payload: dict) -> dict | None:
        status = str(payload.get("status") or "")
        phase = {"extracting": "extracting", "saved": "done", "skipped": "skipped"}.get(status)
        name = Path(str(payload.get("file_name") or "")).name
        if phase and name:
            # Duplicate names: the first entry with that name that is not finished yet.
            entry = next((f for f in self.files if f["file_name"] == name and f["phase"] in {"queued", "extracting"}), None)
            if entry is not None:
                entry.update(phase=phase, percent=PHASE_PERCENT[phase])
                if phase == "skipped" and payload.get("reason"):
                    entry["message"] = str(payload["reason"])
        elif status != "queued":
            return None
        return {"files": deepcopy(self.files)}


def _ingest(app, job: UploadJob, files: list[UploadedBytes], collection: str):
    def on_progress(payload):
        event = job.update(payload)
        if event:
            job.log.publish("upload.progress", event)

    try:
        result = app.state.upload_service_factory().ingest_uploaded_files(
            files, collection_name=collection, progress_callback=on_progress)
    except Exception as exc:
        logger.warning("upload_failed error=%s", type(exc).__name__)
        for entry in job.files:
            if entry["phase"] in {"queued", "extracting"}:
                entry.update(phase="error", percent=PHASE_PERCENT["error"])
        job.log.publish("upload.progress", {"files": deepcopy(job.files)})
        message = str(exc) if isinstance(exc, RuntimeError) else "Não foi possível processar os arquivos."
        job.log.publish("upload.failed", {"message": message, "code": "ingest_failed"}, final=True)
        return
    finally:
        app.state.services.invalidate()
    root = Path(app.state.settings.collections_root).resolve()
    saved_paths = set()
    for item in result.get("files", []):
        try:
            saved_paths.add(Path(item["output_path"]).resolve().relative_to(root).as_posix())
        except (KeyError, ValueError):
            continue
    saved = [d for d in list_documents(app.state.settings.collections_root) if d["relative_path"] in saved_paths]
    skipped = [{"file_name": s.get("name", ""), "reason": str(s.get("reason") or "")} for s in result.get("skipped_files", [])]
    job.log.publish("upload.completed", {"saved": saved, "skipped": skipped}, final=True)


@router.post("/uploads", status_code=202)
async def create_upload(request: Request, collection: str = Form(UPLOAD_COLLECTION_NAME), files: list[UploadFile] = File(...)):
    if collection != UPLOAD_COLLECTION_NAME:
        # LocalUploads writes under collections_root/<collection>; only the upload collection is writable.
        raise ApiError(400, "Coleção de envio inválida.", "collection_unavailable")
    if not files:
        raise ApiError(400, "Nenhum arquivo enviado.", "no_files")
    limit = request.app.state.settings.max_upload_bytes
    received = []
    for upload in files:
        data = await upload.read(limit + 1)
        name = Path(upload.filename or "arquivo").name
        if len(data) > limit:
            raise ApiError(413, f"{name}: maior que o limite de {limit // (1024 * 1024)} MB.", "file_too_large")
        received.append(UploadedBytes(name, data))

    job_id = uuid.uuid4().hex
    job = UploadJob(EventLog(), [f.name for f in received])
    remember(request.app.state.upload_jobs, job_id, job)
    job.log.publish("upload.progress", {"files": deepcopy(job.files)})
    task = asyncio.create_task(anyio.to_thread.run_sync(_ingest, request.app, job, received, collection))
    request.app.state.background_tasks.add(task)
    task.add_done_callback(request.app.state.background_tasks.discard)
    return {"job_id": job_id}


@router.get("/uploads/{job_id}/events")
async def upload_events(request: Request, job_id: str):
    job = request.app.state.upload_jobs.get(job_id)
    if job is None:
        raise ApiError(404, "Envio não encontrado.", "upload_not_found")
    return sse_response(job.log.follow(request.app.state.keep_alive_seconds))
