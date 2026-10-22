# Upgrading to a new approved core release

QwenRAG adopts core releases deliberately. A new release in RAG-UFC changes nothing here until these
steps are reviewed and merged.

```text
Approved RAG-UFC core release (releases/rag-ufc-core/<version>.json)
        ↓  update the commit pin
QwenRAG dependency update  →  verify manifest/lock  →  contract and integration tests
        ↓  regression checks  →  review and merge  →  deploy (rebuild indexes if required)
```

1. **Read the release record** in RAG-UFC: `releases/rag-ufc-core/<version>.json` (commit, source
   fingerprint, wheel hash, approval status, maintainer sign-off) and the package's `RELEASE.json`
   (`release_kind`, `approval`, `included_candidates`, `evaluation`, `index_compatibility`). Adopt only
   `approved` or `baseline_continuity` releases.
2. **Update the pin** in `backend/pyproject.toml`: the version in `dependencies` and `rev` in
   `[tool.uv.sources]` (the release's `core_commit`). Then:

   ```bash
   cd backend
   uv lock && uv sync
   uv run python -m qwenrag.core_lock --commit <core_commit>   # rewrites ../core-release.lock.json
   ```

   `core_lock` refuses if the installed package does not come from that commit.
3. **Check adoption**: `uv run python -m qwenrag --check` must report `approved_match`. Review
   `environment_differences` (dependency versions differing from the evaluated environment).
4. **Indexes**: if `index_compatibility` changed (format version, representation id or chunker), plan the
   rebuild: the first question per collection rebuilds the index (time proportional to the corpus). For
   large corpora, warm it before switching traffic. Old `.npz` files can be removed afterwards.
5. **Tests**: `uv run pytest` in `backend/` (contract, SSE, idempotency, adoption, boundary and
   integration tests) and `npm run typecheck && npm test && npm run build` in `frontend/`.
6. **Representative regression check** (manual, needs the model services): ask a few known questions from
   the RAG-UFC regression set and compare claims and citations with the release notes. Record
   anything unexpected for the research team.
7. **Review and merge** the pin, lock and any configuration changes in one pull request; the PR description
   cites the release record. Deploy; `GET /api/diagnostics/pipeline` must show the new release.

Rollback is the reverse: restore the previous pin and lock, `uv sync`, and restart. Indexes built for the
previous release are reused if they are still in `data/cache/rag_v2/`.

## What never to do

* Copy or patch engine code in this repository.
* Pin a branch instead of a commit.
* Change pipeline settings through `[core.deployment]` (rejected) or silently through `[core.overrides]`
  (reported as `divergent`).
