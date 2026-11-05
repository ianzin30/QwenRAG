# Spark model services for local QwenRAG development

The SSH tunnel forwards only loopback ports. The application, documents and
index stay on the developer's computer. No source-code deployment is required
when a developer edits or restarts the local backend.

| Spark port | Local port | Service |
| --- | --- | --- |
| 8000 | 18000 | Qwen 3.6: `/v1/chat/completions`, `/tokenize` |
| 8003 | 18003 | Nemotron Embed 8B: `/v1/embeddings` |
| 8006 | 18006 | Nemotron Rerank 8B: `/v1/rerank` |
| 8007 | 18007 | BGE-M3 CPU: `/health`, `/tokenize`, `/v1/lexical` |

The BGE-M3 service uses the existing Spark environment
`~/ian/exp_retrieval/envs/e04_ref_venv` and the cached revision
`5617a9f61b028005a4858fdac845db406aefb181`. It listens only on
`127.0.0.1:8007`. The installed copy is
`~/ian/exp_retrieval/bge_lexical_qwenrag/server.py`. To restart it after
a host reboot, run as the service account on the Spark:

```sh
cd ~/ian/exp_retrieval/bge_lexical_qwenrag
HF_HUB_OFFLINE=1 nohup ../envs/e04_ref_venv/bin/python -u server.py \
  ~/.cache/huggingface/hub/models--BAAI--bge-m3/snapshots/5617a9f61b028005a4858fdac845db406aefb181 \
  > service.log 2>&1 < /dev/null &
```

The source is [bge_lexical.py](../scripts/spark/bge_lexical.py). The
Nemotron index fingerprint includes the model, dimensionality, prompt
prefixes and BGE lexical revision. Switching between the new and old profile
does not overwrite the other profile's index files.
