# Architecture

```text
QwenRAG                                              RAG-UFC (research + core)
├── frontend/   React + TypeScript (Vite)            packages/rag-ufc-core  ──┐
│                 │ /api, SSE                                                │ released, pinned
├── backend/qwenrag/                                                         │ by git commit
│   ├── api/            HTTP routes, SSE, errors   ◀── rag-ufc-core 1.0.0 ◀──┘
│   ├── workflows/      turn coordination, progress labels
│   ├── persistence/    conversation store (JSON), conversation records
│   ├── catalog.py      document library (opaque ids)
│   ├── core_runtime.py pinned release check, pipeline identity, secrets
│   └── settings.py     config/qwenrag.toml + environment
├── config/qwenrag.toml  deployment settings (not the pipeline)
├── core-release.lock.json  the adopted core release
└── data/  (not in Git) collections/, cache/rag_v2/, conversations.json
```

## Who owns what

| Concern | Owner |
|---|---|
| Retrieval, reranking, evidence coverage, generation, verification, citations | rag-ufc-core |
| Document → Markdown extraction (uploads) and the index built from it | rag-ufc-core |
| Pipeline configuration (models, retrieval parameters, prompts) | the core release (`RELEASE.json`) |
| HTTP, SSE, conversations, idempotency, uploads jobs, document library | QwenRAG |
| Endpoints, credentials, timeouts, device, data locations | QwenRAG (`config/qwenrag.toml`, `.env`) |
| Research, benchmarks, evaluation, release approval | RAG-UFC |

QwenRAG imports only the core's stable modules (`rag_ufc_core`, `.collections`, `.errors`, `.results`,
`.secret_source`, `.identity`, `.LocalUploads`); `backend/tests/test_boundaries.py` enforces it and that
nothing from the research repository is imported.

## Shared concerns, separate owners

* **Progress.** The core emits stage and index events; `workflows/progress.py` names them and
  `api/turns.py` sends them as `turn.progress`.
* **History.** `TurnCoordinator.semantic_history` selects completed pairs (last `history_messages`); the
  core receives plain `{role, content}` messages.
* **Cancellation.** The client can abort the request; the job keeps running and stores its result.
  Python-side interruption is not implemented (`features.cancel_turn = false`).
* **Configuration.** The core defines and validates settings; QwenRAG supplies deployment values only.

## Turn lifecycle

1. `POST /api/conversations/{id}/turns` validates the request and calls `TurnCoordinator.begin`, which
   records the question and a `running` turn atomically. The `client_turn_id` is the idempotency key.
2. A worker thread prepares (or reuses) a `RAGService` for (pipeline signature, model, collections),
   loading or building the index, then calls `ask_question_with_trace` once.
3. `TurnCoordinator.finish` stores the answer or the public error. It is idempotent: a stored turn never
   receives a second answer. The turn and the message record which core release, pipeline signature and
   index fingerprint produced the answer.
4. Events go to a replayable log: closing the tab or reconnecting never repeats the question; a repeated
   `client_turn_id` replays from memory or storage.

## Operational limits (current)

* **One process, one worker.** Running turns, upload jobs and prepared services live in memory. Run
  uvicorn with a single worker. A restart marks running turns `unknown` (never re-executed).
* **Conversation store.** One JSON file guarded by a thread lock and `fcntl` (local filesystem only).
  Suitable for one host; not for several API instances or network filesystems.
* **No authentication or multi-user separation.** The UI assumes one local workspace. Put the service
  behind an authenticating reverse proxy before exposing it.
* **No server-side cancellation or token streaming.**
* **Google Drive import and scraping** are not part of QwenRAG yet (they remain in the RAG-UFC research UI).

These are deliberate: no database, broker or queue was introduced without an operational need.
