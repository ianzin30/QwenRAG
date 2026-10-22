# Backend integration guide

The routes below are implemented by the FastAPI backend in `backend/qwenrag/` (run it with
`uv run python -m qwenrag` from `backend/`, default `127.0.0.1:8000`; `--port` or `QWENRAG_PORT` to change).
`src/services/api/httpAdapter.ts` and `dto.ts` match it without changes; the places where the real API
differs from the original proposal or adds to it are listed in
[Implementation notes](#implementation-notes-fastapi). Field names reuse what the RAG core produces.

Base URL: `VITE_API_BASE_URL` (default `/api`). JSON errors: `{"detail": "...", "code": "..."}`
(FastAPI's default `detail` already works; `code` is optional).

## Where each piece comes from

| Frontend need | Backend | Notes |
| --- | --- | --- |
| Answer a question | `rag_ufc_core.RAGService.ask_question_with_trace(question, history)` via `qwenrag/workflows/turns.py` | Returns the **whole** answer at once. No token streaming today. |
| Turn result shape | `TurnCoordinator.run` → `{content, route, turn_id, turn_state, sources, cited_sources, claims, execution…}` | Normalized by `rag_ufc_core.results.normalize_presentation` |
| Source fields | core trace `cited_sources` → `document_name, chunk_kind, excerpt, relative_path, evidence_id, section_title, provenance[].page_no, claim_ids, focus_spans` | Mapped 1:1 in `dto.ts` |
| Turn states | `answered · partial · casual · abstained · clarification_required`, failures `failed / unknown` | `unknown` = never auto-retry |
| Collection index progress | core collection events (`collection_load_started`, `index_embedding_progress`, …) labelled in `qwenrag/workflows/progress.py` | Forwarded as `turn.progress` |
| Conversations | `qwenrag/persistence` (JSON store with revisions/conflicts at `data/conversations.json`) | Has `turns` with states |
| Model options | `[[models]]` in `config/qwenrag.toml`, restricted to the core release's approved model | |
| Uploads | `rag_ufc_core.LocalUploads.LocalUploadService.ingest_uploaded_files(..., progress_callback)` | Emits per-file progress |
| Documents | `qwenrag/catalog.py`, Markdown under `data/collections/` | Delete removes `.md` + `.structure.json` |
| Pipeline identity | `GET /api/diagnostics/pipeline` | Core release, approval, effective pipeline signature, loaded indexes |
| Google Drive | not migrated (stays in RAG-UFC's research UI) | OAuth must stay server-side |

## Endpoints

### `GET /config`
```json
{
  "models": [{ "model_name": "nvidia/Qwen3.6-35B-A3B-NVFP4", "label": "Qwen 3.6 — Spark", "is_default": true }],
  "upload_types": ["pdf", "docx", "pptx", "xlsx", "csv", "md", "txt", "png", "jpg", "jpeg"],
  "max_upload_bytes": 209715200,
  "excerpt_chars": 900,
  "title_max_chars": 34,
  "features": { "drive_import": false, "cancel_turn": false }
}
```
`excerpt_chars` and `title_max_chars` come from `[chat]` in `config/qwenrag.toml`.

### Collections and documents
- `GET /collections` → `[{ "name": "graduacao", "document_count": 4 }]`
- `GET /documents?collection=graduacao` (collection optional) →
  `[{ "id": "…", "collection": "graduacao", "file_name": "calendario.pdf", "relative_path": "graduacao/calendario.md", "size_bytes": 123, "updated_at": "ISO-8601", "summary": "32 p." }]`
  `id` must be stable and opaque. Don't use raw paths; the server resolves ids to files.
- `GET /documents/{id}/content` → `text/markdown` (the extracted Markdown). The UI treats it as untrusted.
- `DELETE /documents/{id}` → `204`. Only `.md` files under the collections root (`catalog.delete_document_files`).

### Conversations
- `GET /conversations` → `[{ "id", "title", "updated_at", "collection": ["graduacao"], "model" }]`
- `POST /conversations` body `{ "collection": ["graduacao"], "model": "<model_name>" }` → conversation
- `DELETE /conversations/{id}` → `204`
- `GET /conversations/{id}/messages` → list of messages:
```json
{
  "id": "m1", "role": "assistant", "content": "…", "turn_id": "t1", "turn_state": "answered",
  "route": "retrieval", "created_at": "ISO-8601", "collection": ["graduacao"],
  "profile": { "llm": { "model": "nvidia/Qwen3.6-35B-A3B-NVFP4", "label": "Qwen 3.6 — Spark" } },
  "claims": [{ "claim_id": "c1", "text": "…", "evidence_ids": ["E1"] }],
  "cited_sources": [{ "source_id": "…", "evidence_id": "E1", "document_name": "…", "chunk_kind": "text",
                      "section_title": "…", "excerpt": "…", "relative_path": "…",
                      "provenance": [{ "page_no": 3 }], "claim_ids": ["c1"],
                      "focus_spans": [{ "start": 10, "end": 42, "quote": "…", "claim_ids": ["c1"] }],
                      "document_id": "optional — lets 'Abrir documento' resolve without path matching" }],
  "source_warnings": [], "duration_ms": 3400, "execution": { "logical_calls": 4 }
}
```
User messages need only `id, role, content, turn_id, created_at`. Assistant messages without
`turn_id` render as legacy ("Resposta legada", "Fonte histórica"), as the research UI did.

### Asking a question — `POST /conversations/{id}/turns`
Request (`Accept: text/event-stream`):
```json
{ "client_turn_id": "uuid", "question": "…", "model": "<model_name>", "collection": ["graduacao"] }
```
`client_turn_id` is an idempotency key: the same id sent twice must not create two turns.
That mirrors the "never append a second response" rule in `TurnCoordinator.finish`.

Response: `text/event-stream`. Every `data:` field is a JSON object.

| `event:` | `data` | When |
| --- | --- | --- |
| `turn.accepted` | `{ "turn_id", "user_message_id"? }` | As soon as the turn is persisted (`TurnCoordinator.begin`) |
| `turn.progress` | `{ "stage", "label"?, "current"?, "total"? }` | Any number of times. Stages the UI knows: `analyzing`, `retrieving`, `reranking`, `generating`. Unknown stages are shown with their `label`. |
| `answer.delta` | `{ "text" }` | **Optional.** Appended to the visible draft. Skip it until the backend can really stream. |
| `turn.completed` | `{ "message": <assistant message as above> }` | Exactly once on success. Ends the stream. |
| `turn.failed` | `{ "outcome": "failed" \| "unknown", "message", "code"? }` | Exactly once on failure. Ends the stream. |

Rules the frontend relies on:
- A stream that closes without `turn.completed`/`turn.failed` is treated as **unknown outcome**.
  The UI offers "Atualizar histórico" and never re-sends the question on its own.
- A transport error *after* the first event is also treated as unknown. A transport error *before* any event counts as `failed`, and the user can retry.
- Comments (`: keep-alive`) are ignored. Send one every ~15 s on long turns so proxies don't close the connection.
- Use the public error messages `TurnCoordinator.run` builds; never send stack traces.

**Rendering contract for citations.** When `claims` is non-empty, the UI renders the claims in order and puts
citation markers `[n]` after each one, where `n` is the 1-based position of the evidence in
`cited_sources` (the same order the core uses). **`content` is then not displayed**, so
`content` must equal the claims joined. If the backend adds text outside the claims, either
leave `claims` empty (only `content` is shown, still with source cards) or add that text as claims.

### Cancellation (optional) — `POST /turns/{turn_id}/cancel`
The client always aborts the `fetch`. The server should stop generation when the client
disconnects or this endpoint is called, and store the turn as cancelled, without an assistant message.
Advertise support with `features.cancel_turn`.

### Uploads
1. `POST /uploads` — `multipart/form-data` with `collection` and repeated `files` fields.
   Response: `{ "job_id": "…" }`. (Upload progress uses XHR, so this endpoint must accept a normal multipart POST.)
2. `GET /uploads/{job_id}/events` — `text/event-stream`:
   - `upload.progress` `{ "files": [{ "file_name", "phase": "queued|extracting|indexing|done|skipped|error", "percent": 0-100, "message"? }] }`
     (maps onto the core upload progress events)
   - `upload.completed` `{ "saved": [<document>], "skipped": [{ "file_name", "reason" }] }`
   - `upload.failed` `{ "message", "code"? }`

### Google Drive (optional) — `POST /integrations/drive/imports`
Body `{ "collection" }` → `{ "job_id" }`, then the same `/uploads/{job_id}/events` stream.
An OAuth flow (RAG-UFC has one in its research UI) must be implemented as server routes
(for example `/integrations/drive/oauth/start` and a callback). Tokens never reach the browser.
The Drive button only appears when `features.drive_import` is `true`.

## Implementation notes (FastAPI)

The contract is covered by `backend/tests` (route, SSE, idempotency and failure tests with fakes, plus an
upload → index → cited answer test through the real core with an offline encoder and generator). The
prototype of this API in RAG-UFC was validated end to end against the live pipeline; this backend has not
yet been run against the live Spark/Ollama services.

**Wiring.** One uvicorn worker. `TurnCoordinator.begin` runs before the stream opens; `run → finish`
run in a worker thread whose callbacks feed a replayable event log. The job is not tied to the HTTP
connection: closing the tab never loses or repeats the answer. No CORS (use the Vite proxy or a reverse proxy).
Conversations use `qwenrag/persistence/store.py` (one JSON file, revision/conflict rules ported from RAG-UFC).
Prepared `RAGService` instances are cached per (pipeline signature, model, collections) and dropped after
an upload or delete, so the next turn reloads the (fingerprinted, cached) index.

**Turns**
- `client_turn_id` (8–80 chars of `[A-Za-z0-9_-]`) **is** the server `turn_id`, so `turn.accepted.turn_id`
  equals it; `user_message_id` is `"<turn_id>-user"` and the assistant message id `"<turn_id>-assistant"`.
- Same `client_turn_id` again → the same events are replayed (from memory while the job runs, from storage
  after a restart, `code: "replayed"` on stored failures). It is never executed twice. Same id on another
  conversation → `409 turn_conflict`.
- Errors before the stream opens are plain JSON (so the UI treats them as retryable `failed`):
  `400 invalid_client_turn_id | empty_question | model_unavailable | collection_unavailable`,
  `404 conversation_not_found`, `409 no_documents | turn_running` or the `Storage` conflict message
  (another question running in this conversation, e.g. from another tab), `503 storage_failed`.
- Extra `turn.progress` stages, always with a `label`: `indexing` (collection load/index build, with
  `current/total` when known, from `workflows/progress.py`), `verifying`, `source_focus`.
  `planning→analyzing`, `retrieval→retrieving`, `reasoning→reranking` (label "Analisando as evidências…"),
  `answer→generating`. Labels come from `workflows/progress.py`.
- `turn.failed.message` is the public message from `TurnCoordinator.run` (e.g. "Entrada excede a janela local…",
  "A saída atingiu max_tokens…"). Failures while preparing the model/collection are `failed` with the
  same public message as other preparation failures. If the answer was generated but could not be saved, the event is
  `outcome: "unknown"`, `code: "storage_failed"`.
- Keep-alive is `: ping` every 15 s.

**Messages**
- When `claims` is non-empty and `content` has text before the first claim (Flow's
  "Resposta parcial — falta: …" prefix on `partial`), that text is sent as a first claim
  `{claim_id: "preamble", evidence_ids: []}` so the claims-only rendering keeps it.
- Sources never include server paths (`source`, `source_name` are dropped). `document_id` is set when the
  cited `relative_path` still exists in the library. `execution` is reduced to `logical_calls` and
  `transport_attempts` (no endpoints). `profile.llm.label` comes from `[llm_models]`.
- **Addition:** `profile.pipeline` = `{core_version, pipeline_signature, adoption_status}` on assistant messages:
  which core release and pipeline produced the answer. The stored turn also keeps the index fingerprint.
- Legacy assistant messages (no `turn_id`) are sent with `sources`, not `cited_sources`.
  `casual` answers have no sources.
- **Addition, not used by the UI yet:** user messages carry `turn_state` (`running`, `failed`, `unknown`, …)
  and, for failed/unknown turns, `error`. Today a failed question loaded from history shows only the
  question; the UI could render the stored error from these fields.
- `created_at` comes from the turn (`created_at` for the question, `finished_at` for the answer);
  `duration_ms` is the whole turn including model/collection preparation.

**Conversations.** `POST` returns `201`. The session limit applies (`[chat].max_sessions`,
6 by default): the 7th conversation is `409 conversation_limit` with a message telling the user to delete one.
The UI creates a conversation on the first question, so it shows that message as a toast. A conversation
with a running question cannot be deleted (`409`). Deleting the last conversation does not create a new one.
Titles follow the first question (`TurnCoordinator.begin`).

**Collections and documents.** Every Markdown file under `data/collections/` belongs to the
single collection `uploaded_files`, the only valid `collection` for uploads (`400` otherwise).
`id` is `doc_` + 24 hex chars of SHA-256 of the relative path (stable while the file exists). `file_name` is the
original name from the extract's `# <name>` heading when present (so `calendario.pdf`, not `01_calendario.md`).
No `summary` is sent.

**Uploads.** `POST /uploads` returns `202 {job_id}`; files over 200 MB → `413 file_too_large`.
Server phases map onto the client's 30–100 % range: `queued` 30, `extracting` 60, `done`/`skipped`/`error` 100
(`message` carries the skip reason). There is no server `indexing` phase: the index is rebuilt on the next question
(the `indexing` turn stage). If no file could be processed the stream ends with `upload.failed`
(the core upload service's message). The events stream can be reopened and replays from the start.

**Diagnostics.** `GET /diagnostics/pipeline` returns the core release (version, approval status, pinned commit),
the adoption check (`approved_match`, `divergent`, `unapproved`, `pin_mismatch`, with divergent fields and
dependency differences), the pipeline signature/config hash, model identities and the loaded indexes. It never
includes endpoints, credential variable names or server paths. The UI does not use it yet.

## Not connected yet

| Feature | Status |
| --- | --- |
| Failed/unknown questions loaded from history | Shown as a bare question. The API sends `turn_state` and `error` on user messages; the UI doesn't render them yet. |
| "Fechar" on a failed turn | Removes the question locally only. It stays in the server history and reappears after a reload. |
| Messages changed elsewhere (another tab) | A conversation's messages are fetched once; they refresh on reload or "Atualizar histórico". |
| Token streaming (`answer.delta`) | The backend returns complete answers. The UI shows stage progress, then the final answer. |
| Server-side cancel | Client abort works. Python-side interruption of a running turn still needs implementing. |
| Google Drive import | Mock only. Needs server-side OAuth routes plus `features.drive_import`. |
| Scraping | Not in the prototypes, so not built (RAG-UFC's research UI has a scraper). |
| Conversation rename | Not in the prototypes. The title comes from the first question (34 chars). |
| Message pagination, auth/multi-user | Not designed yet. The UI assumes one local workspace ("Workspace local"). |
| "Abrir documento" scrolling to the exact passage | The view shows the cited excerpt highlighted on top of the document. It doesn't scroll to that spot inside the Markdown. |
| E2E / visual regression tests | Not set up. Unit tests cover the SSE parser, turn reducer and highlight ports. |
