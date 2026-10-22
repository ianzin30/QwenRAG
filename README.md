# QwenRAG

Question answering over institutional documents with cited answers: a React frontend and a
FastAPI backend on top of **rag-ufc-core**, the RAG engine developed and scientifically validated in
[RAG-UFC](https://github.com/ianzin30/RAG_UFC).

QwenRAG does not contain the engine. It installs an approved, versioned core release pinned to an
immutable commit, verifies it at startup, and records with every answer which release and pipeline
produced it.

## Requirements

* Python 3.11 and [uv](https://docs.astral.sh/uv/); Node 18.18+.
* Model services reachable from the backend: the Spark OpenAI-compatible endpoint (generation, key in
  `LLM_API_KEY`) and Ollama with `embeddinggemma:latest` (embeddings).
* The Hugging Face cache must contain `BAAI/bge-reranker-v2-m3` and the
  `nvidia/Qwen3.6-35B-A3B-NVFP4` tokenizer (the server runs with `HF_HUB_OFFLINE=1`).

## Run

```bash
cp .env.example .env                       # fill LLM_API_KEY
cd frontend && npm install && npm run build && cd ..   # builds the UI the backend serves
cd backend
uv sync                                    # installs the pinned rag-ufc-core from GitHub
uv run python -m qwenrag --check           # verifies the core release and prints the pipeline identity
uv run python -m qwenrag                   # open http://127.0.0.1:8010 (UI) · API under /api · docs at /api/docs
```

Port 8010 by default (`--port` or `QWENRAG_PORT`). Without a UI build, the root page explains how to
build it; `/api/...` works either way.

For frontend development with hot reload, keep the backend running and in another terminal:

```bash
cd frontend
cp .env.example .env.local        # VITE_DEV_PROXY_TARGET=http://127.0.0.1:8010
npm run dev                       # http://localhost:5173 (npm run dev:mock needs no backend)
```

Configuration: `config/qwenrag.toml` (data locations, models offered, deployment endpoints). The RAG
pipeline itself comes from the core release; see [docs/core-integration.md](docs/core-integration.md).
Documents, indexes and conversations are stored under `data/` (not in Git).

## Test

```bash
cd backend && uv run pytest                                   # API contract, SSE, idempotency, core adoption
cd frontend && npm run typecheck && npm test && npm run build
```

Backend tests use fakes and an offline encoder; they never call models or the network.

## Documentation

* [docs/architecture.md](docs/architecture.md): components, ownership, turn lifecycle, operational limits
* [docs/core-integration.md](docs/core-integration.md): installing the core, resources, pipeline identity, diagnosing mismatches
* [docs/core-upgrade.md](docs/core-upgrade.md): adopting a new approved core release
* [frontend/docs/INTEGRATION.md](frontend/docs/INTEGRATION.md): HTTP/SSE contract between frontend and backend
* [frontend/README.md](frontend/README.md): frontend structure

## Current core

`rag-ufc-core 1.0.0` (`core-release.lock.json`), release kind `baseline_continuity`: the RAG-UFC
production pipeline repackaged without behavioral change. Research candidates such as Track B E04 are
not part of it.
