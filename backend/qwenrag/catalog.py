"""User-facing document library over the collections root.

Every Markdown extract under the root belongs to the single ``uploaded_files``
collection (as in the RAG-UFC research UI). Ids are opaque hashes of relative
paths; only ``.md`` files inside the root can be read or deleted.
"""
from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import re

from rag_ufc_core.collections import UPLOAD_COLLECTION_NAME

UPLOAD_FILE_TYPES = ["pdf", "docx", "pptx", "xlsx", "csv", "md", "txt", "html",
                     "png", "jpg", "jpeg", "webp", "tiff", "bmp"]
_ORIGINAL_NAME = re.compile(r"^# (.+\.[A-Za-z0-9]{1,8})\s*$")


class DocumentError(RuntimeError):
    pass


def document_id(relative_path: str) -> str:
    return "doc_" + sha256(relative_path.encode("utf-8")).hexdigest()[:24]


def scan(root: Path) -> list[dict]:
    root = Path(root)
    if not root.exists():
        return []
    files = sorted((p for p in root.rglob("*.md") if p.is_file()), key=lambda p: p.relative_to(root).as_posix().lower())
    return [{"collection": UPLOAD_COLLECTION_NAME, "file_name": p.name, "relative_path": p.relative_to(root).as_posix(),
             "label": re.sub(r"^\d+[_\- ]*", "", p.stem).strip() or p.stem} for p in files]


def available_collections(root: Path) -> list[str]:
    return [UPLOAD_COLLECTION_NAME] if scan(root) else []


def _original_name(path: Path) -> str | None:
    """Uploads start with '# <original file name>'; show that instead of the extract name."""
    try:
        with path.open(encoding="utf-8") as handle:
            first = handle.readline()
    except (OSError, UnicodeDecodeError):
        return None
    match = _ORIGINAL_NAME.match(first.strip())
    return Path(match.group(1)).name if match else None


def list_documents(root: Path) -> list[dict]:
    documents = []
    for document in scan(root):
        path = Path(root) / document["relative_path"]
        try:
            stat = path.stat()
        except OSError:
            continue
        documents.append({
            "id": document_id(document["relative_path"]),
            "collection": document["collection"],
            "file_name": _original_name(path) or document["file_name"],
            "relative_path": document["relative_path"],
            "size_bytes": stat.st_size,
            "updated_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        })
    return documents


def find_document(root: Path, identifier: str) -> dict | None:
    return next((d for d in scan(root) if document_id(d["relative_path"]) == identifier), None)


def resolve_document_path(document: dict, root: Path) -> Path:
    root = Path(root).resolve()
    relative = Path(str(document.get("relative_path") or document.get("file_name") or ""))
    if not relative.name:
        raise DocumentError("Arquivo nao identificado para exclusao.")
    resolved = (root / relative).resolve()
    if not resolved.is_relative_to(root):
        raise DocumentError("Caminho de arquivo invalido para exclusao.")
    if resolved.suffix.lower() != ".md":
        raise DocumentError("Apenas arquivos extraidos em Markdown podem ser excluidos pela interface.")
    return resolved


def delete_document_files(document: dict, root: Path) -> Path:
    """Remove the extract, its structure sidecar and an emptied subfolder."""
    path = resolve_document_path(document, root)
    if not path.exists():
        raise DocumentError("Arquivo nao encontrado. Talvez ele ja tenha sido removido.")
    path.unlink()
    path.with_suffix(".structure.json").unlink(missing_ok=True)
    try:
        if path.parent != Path(root).resolve() and path.parent.exists() and not any(path.parent.iterdir()):
            path.parent.rmdir()
    except OSError:
        pass
    return path
