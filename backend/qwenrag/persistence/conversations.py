"""Conversation records: creation, titles and timestamps (no UI state)."""
from __future__ import annotations

from datetime import datetime, timezone
import re
import uuid

from rag_ufc_core.collections import normalize_collection_selection

__all__ = ["build_default_title", "build_timestamp_now", "create_session", "normalize_collection_selection", "truncate_title"]


def build_timestamp_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_default_title(default_title: str, existing_titles) -> str:
    titles = set(existing_titles or ())
    if default_title not in titles:
        return default_title
    index = 2
    while f"{default_title} {index}" in titles:
        index += 1
    return f"{default_title} {index}"


def truncate_title(text: str, max_length: int, default_title: str) -> str:
    normalized = re.sub(r"\s+", " ", (text or "").strip())
    if not normalized:
        return default_title
    if len(normalized) <= max_length:
        return normalized
    return normalized[: max_length - 3].rstrip() + "..."


def create_session(collection, model_name, *, default_title: str, existing_titles=()) -> dict:
    timestamp = build_timestamp_now()
    selection = normalize_collection_selection(collection)
    return {"id": "chat_" + uuid.uuid4().hex, "title": build_default_title(default_title, existing_titles),
            "collection": list(selection) or None, "model_name": model_name,
            "messages": [], "turns": [], "revision": 0, "created_at": timestamp, "updated_at": timestamp}
