# QwenRAG

Question answering over institutional documents with cited answers: a React frontend and a
FastAPI backend on top of **rag-ufc-core**, the RAG engine developed and scientifically validated in
[RAG-UFC](https://github.com/ianzin30/RAG_UFC).

QwenRAG does not contain the engine. It installs an approved, versioned core release pinned to an
immutable commit, verifies it at startup, and records with every answer which release and pipeline
produced it.

## Requirements

* Python 3.11 and [uv](https://docs.astral.sh/uv/); Node 18.18+.
* The default configuration keeps the app and its indexes on the developer's computer
  and calls the Spark for Qwen 3.6 generation and chat tokenization, Nemotron
  embeddings and reranking, and BGE-M3 lexical weights and text tokenization.
  No local model cache or Ollama is needed for this profile. Keep `LLM_API_KEY`
  configured for the generation client.

Keep one SSH tunnel open with your own authorized Spark account:

```bash
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:18000:127.0.0.1:8000 \
  -L 127.0.0.1:18003:127.0.0.1:8003 \
  -L 127.0.0.1:18006:127.0.0.1:8006 \
  -L 127.0.0.1:18007:127.0.0.1:8007 \
  YOUR_SSH_USER@10.101.61.229
```

The committed `config/qwenrag.toml` matches these ports. The first collection
load builds a Nemotron index alongside any previous EmbeddingGemma index.
The app reports the new models as deliberate divergences from the pinned
core release. Remote failures are surfaced rather than switching models.
See [Spark services](docs/spark-services.md) for service contracts and the
BGE-M3 server. The BGE-M3 service on the Spark uses CPU; the other models
use GPU.

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
