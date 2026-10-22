"""Engine progress events → user-facing progress (labels from the Streamlit chat).

The core emits execution stages; this module only names them for the UI.
"""
from __future__ import annotations

DEFAULT_RESPONSE_STATUS_MESSAGE = "Analisando sua pergunta..."
RESPONSE_STAGE_LABELS = {
    "planning": "Preparando a busca...", "retrieval": "Buscando evidências...",
    "reasoning": "Analisando as evidências...", "answer": "Redigindo a resposta...",
    "verification": "Conferindo a resposta...", "source_focus": "Organizando as fontes...",
}
# Core stage names → stages the frontend knows; others pass through with their label.
FRONTEND_STAGES = {"planning": "analyzing", "retrieval": "retrieving", "reasoning": "reranking", "answer": "generating",
                   "verification": "verifying", "source_focus": "source_focus"}

COLLECTION_PROGRESS_LABELS = {
    "collection_load_started": "Preparando a base de arquivos...",
    "collection_fingerprint_ready": "Conferindo se os arquivos mudaram desde o ultimo indice...",
    "collection_cache_restore_started": "Cache encontrado. Restaurando o indice salvo...",
    "collection_cache_restored": "Indice restaurado do cache.",
    "collection_index_build_started": "Arquivos mudaram. Construindo um novo indice de busca...",
    "collection_documents_loaded": "Markdown carregado. Organizando documentos para busca...",
    "index_chunking_started": "Separando documentos em trechos pesquisaveis...",
    "index_chunking_progress": "Separando documentos em trechos pesquisaveis...",
    "index_embedding_started": "Gerando embeddings dos trechos...",
    "index_embedding_progress": "Gerando embeddings dos trechos...",
    "index_faiss_build_started": "Montando indice vetorial para consultas rapidas...",
    "index_faiss_build_completed": "Indice vetorial montado.",
    "collection_cache_write_started": "Salvando indice local para acelerar as proximas perguntas...",
    "collection_cache_written": "Pronto!",
}


def _int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def collection_progress_label(payload) -> str:
    if not isinstance(payload, dict):
        return "Atualizando a base de arquivos..."
    event = str(payload.get("event") or "").strip()
    base = COLLECTION_PROGRESS_LABELS.get(event, "Atualizando a base de arquivos...")
    completed, total = _int(payload.get("completed")), _int(payload.get("total"))
    file_count, document_count = _int(payload.get("file_count")), _int(payload.get("document_count"))
    chunk_count = _int(payload.get("chunk_count"))
    document_name = str(payload.get("document_name") or "").strip()
    if event == "collection_fingerprint_ready" and file_count:
        return f"{base} {file_count} arquivo(s) verificado(s)."
    if event == "collection_index_build_started" and file_count:
        return f"{base} {file_count} arquivo(s) serao indexados."
    if event == "collection_documents_loaded" and document_count:
        return f"{base} {document_count} documento(s) lido(s)."
    if event == "index_chunking_started" and total:
        return f"{base} 0/{total} documento(s) preparados."
    if event == "index_chunking_progress":
        detail = f" Agora: {document_name}." if document_name else ""
        if total:
            return f"{base} {completed}/{total} documento(s), {chunk_count} trecho(s).{detail}"
        return f"{base} {chunk_count} trecho(s).{detail}"
    if event == "index_embedding_started" and total:
        return f"{base} 0/{total} trecho(s) vetorizado(s)."
    if event == "index_embedding_progress" and total:
        return f"{base} {completed}/{total} trecho(s) vetorizado(s)."
    if event == "index_faiss_build_started" and chunk_count:
        return f"{base} {chunk_count} trecho(s) entrando no indice."
    return base


def collection_progress(payload) -> dict:
    event = {"stage": "indexing", "label": collection_progress_label(payload)}
    if isinstance(payload, dict) and isinstance(payload.get("total"), int) and payload["total"] > 0:
        event.update(current=int(payload.get("completed") or 0), total=payload["total"])
    return event


def response_progress(payload) -> dict:
    raw = str((payload or {}).get("stage") or "") if isinstance(payload, dict) else ""
    message = str((payload or {}).get("message") or "").strip() if isinstance(payload, dict) else str(payload or "").strip()
    label = RESPONSE_STAGE_LABELS.get(message, message) or DEFAULT_RESPONSE_STATUS_MESSAGE
    return {"stage": FRONTEND_STAGES.get(raw, raw or "processing"), "label": label}
