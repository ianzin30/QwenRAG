# Integrating rag-ufc-core

## Installation

`backend/pyproject.toml` depends on `rag-ufc-core[docling]==1.0.0`, sourced from an immutable commit of
the RAG-UFC repository:

```toml
[tool.uv.sources]
rag-ufc-core = { git = "https://github.com/ianzin30/RAG_UFC.git", rev = "<commit>", subdirectory = "packages/rag-ufc-core" }
```

`uv sync` installs it into the backend virtualenv like any other package. No RAG-UFC checkout is needed,
and no engine code lives in this repository.

## Where the pipeline comes from

`core_runtime.CoreRuntime` builds the engine settings with
`EngineSettings.from_release(deployment, overrides=...)`:

* the **pipeline** (models, sampling, output budgets, retrieval parameters, chunking) comes from the
  installed package's `RELEASE.json`, i.e. exactly what the release was approved to run;
* `[core.deployment]` in `config/qwenrag.toml` may only set operational fields (endpoints, credential
  variable names, timeouts, device, batch sizes); anything else is rejected;
* `[core.overrides]` deliberately changes the pipeline. The identity then differs from the release and
  startup refuses unless `core.allow_divergent_pipeline = true`.

Models offered in the UI must be the release's approved model unless divergence is allowed.

## Resources

| Resource | Setting |
|---|---|
| Generation (Spark, OpenAI-compatible) | `[core.deployment.llm.providers.spark] base_url`, key in `.env` as `LLM_API_KEY` |
| Embeddings (Ollama, `embeddinggemma:latest`) | `[core.deployment.retrieval] embedding_ollama_base_url` |
| Reranker (`BAAI/bge-reranker-v2-m3`) and Qwen tokenizer | Hugging Face cache; `python -m qwenrag` runs with `HF_HUB_OFFLINE=1`, so download them once beforehand |
| Documents, indexes, conversations | `data_root` (`collections/`, `cache/rag_v2/`, `conversations.json`) |

Secrets are read from the process environment first, then from `env_file`; they never enter settings,
identities, logs or diagnostics.

## Runtime pipeline identity

At startup QwenRAG verifies the installed core against `core-release.lock.json`: version, source
fingerprint (hash of the installed Python sources), `RELEASE.json` hash, approved pipeline hash, approval
status and, for git installs, the commit. It then compares the effective pipeline with the release
(`rag_ufc_core.check_adoption`):

| Status | Meaning | Startup |
|---|---|---|
| `approved_match` | Installed release = lock, effective pipeline = approved pipeline | runs |
| `divergent` | Configuration or index format differs from the release; fields listed | refused unless allowed |
| `unapproved` | The installed release is a candidate, experimental or rejected | refused unless allowed |
| `pin_mismatch` | Installed package differs from the lock | refused unless allowed |

Dependency versions that differ from the release's evaluated environment are listed as
`environment_differences` (warnings). Libraries that shape the searchable corpus are constrained to the evaluated
version in `backend/pyproject.toml` (`[tool.uv] constraint-dependencies`, currently `pypdf==6.9.2`); review
that list when adopting a new release.

`GET /api/diagnostics/pipeline` and `uv run python -m qwenrag --check` show the release, the adoption
report, the pipeline signature and config hash, the model identities and the loaded index fingerprints,
with no endpoints, credential names or paths. Every stored turn keeps
`profile.pipeline = {core_version, core_source_fingerprint, pipeline_signature, pipeline_config_hash,
adoption_status}` and `profile.index` (index fingerprint), so an answer can be traced to the exact
pipeline and compared with research runs.

## Diagnosing mismatches

* **`pin_mismatch` after `uv sync`**: the dependency changed without re-adoption. Follow
  [core-upgrade.md](core-upgrade.md) or revert `pyproject.toml`/`uv.lock`.
* **`divergent` on `pipeline_config.*`**: something in `[core.overrides]` (or an unapproved model) changes
  the pipeline. Remove it, or ask RAG-UFC for a release that approves it.
* **`divergent` on `index_format.*`**: the release reads a different index format or representation; build
  new indexes (next section).
* **Comparing with a research run**: RAG-UFC's `python -m benchmark.promotion config-identity --code-zip
  <run>/code.zip --llm-section benchmark.llm --compare-release` lists the differences between that run's
  configuration and the release. Component-level research results do not transfer automatically.

## Indexes

Indexes live in `data/cache/rag_v2/<fingerprint>.npz`. The fingerprint covers the corpus files, chunking
settings, encoder identity and tokenizer, so an incompatible index is never reused: it is rebuilt on the
first question after a change (progress stage `indexing`). Updating the core never rebuilds frozen research
indexes; QwenRAG's indexes are its own.
