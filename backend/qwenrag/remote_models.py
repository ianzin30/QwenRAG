"""HTTP adapters for Spark tokenization and hybrid retrieval."""
from functools import lru_cache
import json
import math
from urllib.request import Request, urlopen

import numpy as np
from rag_ufc_core.rag.v2.Providers import ProviderError


class SparkHTTP:
    def __init__(self, url, timeout, service):
        self.url, self.timeout, self.service = str(url).rstrip("/"), timeout, service

    def call(self, path, payload=None):
        try:
            req = Request(self.url + path,
                          data=None if payload is None else json.dumps(payload, ensure_ascii=False).encode(),
                          headers={} if payload is None else {"Content-Type": "application/json"})
            with urlopen(req, timeout=self.timeout) as response:
                result = json.load(response)
        except (OSError, ValueError) as exc:
            raise ProviderError(f"Falha no serviço {self.service} da Spark. Confira o túnel SSH.") from exc
        if not isinstance(result, dict):
            raise ProviderError(f"Resposta inválida do serviço {self.service} da Spark.")
        return result


class RemoteChatTokenizer:
    def __init__(self, base_url, model, timeout):
        self.client = SparkHTTP(base_url.removesuffix("/v1"), timeout, "tokenização do Qwen")
        self.model = model

    def apply_chat_template(self, messages, *, tokenize, add_generation_prompt, **kwargs):
        if not tokenize:
            raise ValueError("The remote tokenizer only returns a token sequence")
        result = self.client.call("/tokenize", {
            "model": self.model, "messages": messages, "add_generation_prompt": add_generation_prompt,
            "chat_template_kwargs": kwargs,
        })
        count, tokens = result.get("count"), result.get("tokens")
        if type(count) is not int or count < 0 or not isinstance(tokens, list) or len(tokens) != count:
            raise ProviderError("Contagem de tokens inválida no servidor Qwen.")
        return tokens


class RemoteLexicalTokenizer:
    def __init__(self, client, model, revision):
        self.client, self.model, self.revision = client, model, revision
        self.name_or_path = f"{model}@{revision}"
        self._cached = lru_cache(maxsize=256)(self._tokenize)

    def _tokenize(self, text, offsets):
        result = self.client.call("/tokenize", {"text": text, "return_offsets_mapping": offsets})
        ids = result.get("input_ids")
        spans = result.get("offset_mapping")
        if (result.get("model") != self.model or result.get("revision") != self.revision
                or not isinstance(ids, list) or (offsets and (
                    not isinstance(spans, list) or len(spans) != len(ids)
                    or any(not isinstance(p, list) or len(p) != 2
                           or any(type(i) is not int for i in p)
                           or not 0 <= p[0] <= p[1] <= len(text) for p in spans)))):
            raise ProviderError("Tokenização BGE-M3 inválida ou revisão divergente.")
        return result

    def __call__(self, text, *, add_special_tokens=False, return_offsets_mapping=False, **_):
        if add_special_tokens:
            raise ValueError("Only text tokens without special tokens are supported")
        return self._cached(text, return_offsets_mapping)

    def encode(self, text, *, add_special_tokens=False):
        return self(text, add_special_tokens=add_special_tokens)["input_ids"]


class RemoteHybridEncoder:
    dimensions = 4096
    query_prefix = "query: "
    document_prefix = "passage: "
    lexical_model = "BAAI/bge-m3"

    def __init__(self, config, settings):
        self.dense = SparkHTTP(settings.embedding_url, settings.timeout_seconds, "embeddings Nemotron")
        self.lexical = SparkHTTP(settings.lexical_url, settings.timeout_seconds, "busca lexical BGE-M3")
        self.model = settings.embedding_model
        self.revision = settings.lexical_revision
        self.batch = min(config.batch_size, 32)
        self.lexical_max_length = config.child_tokens + 128
        self.tokenizer = RemoteLexicalTokenizer(self.lexical, self.lexical_model, self.revision)
        self.identity = {
            "provider": "spark_nemotron_dense_bge_sparse",
            "model": self.model, "dimensions": self.dimensions,
            "query_prefix": self.query_prefix, "document_prefix": self.document_prefix,
            "sparse_encoder": {"model": self.lexical_model, "revision": self.revision,
                               "max_length": self.lexical_max_length},
        }
        self.verify_model_unchanged()

    def verify_model_unchanged(self):
        models = self.dense.call("/v1/models").get("data", [])
        if not any(isinstance(row, dict) and row.get("id") == self.model for row in models):
            raise ProviderError("O servidor de embeddings não oferece o Nemotron configurado.")
        info = self.lexical.call("/health")
        if (info.get("status"), info.get("model"), info.get("revision")) != (
            "ok", self.lexical_model, self.revision
        ):
            raise ProviderError("O BGE-M3 remoto não está pronto na revisão esperada.")

    def _vectors(self, texts, prefix):
        result = self.dense.call("/v1/embeddings", {"model": self.model, "input": [prefix + t for t in texts]})
        try:
            rows = result["data"]
            indices = [row["index"] for row in rows]
            if (result.get("model") != self.model or any(type(i) is not int for i in indices)
                    or sorted(indices) != list(range(len(texts)))):
                raise ValueError()
            vectors = np.asarray([row["embedding"] for row in sorted(rows, key=lambda row: row["index"])],
                                 dtype=np.float32)
            if (vectors.shape != (len(texts), self.dimensions) or not np.isfinite(vectors).all()
                    or not np.allclose(np.linalg.norm(vectors, axis=1), 1, atol=1e-3)):
                raise ValueError()
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderError("Vetores Nemotron inválidos ou incompatíveis com o índice.") from exc
        return vectors

    def _encode(self, texts, prefix):
        vectors, weights = [], []
        for start in range(0, len(texts), self.batch):
            batch = list(texts[start:start + self.batch])
            vectors.append(self._vectors(batch, prefix))
            result = self.lexical.call("/v1/lexical", {"input": batch, "max_length": self.lexical_max_length})
            rows = result.get("weights")
            if (result.get("model") != self.lexical_model or result.get("revision") != self.revision
                    or not isinstance(rows, list) or len(rows) != len(batch)
                    or any(not isinstance(row, dict) or any(type(x) not in (float, int) or not math.isfinite(x)
                                                           for x in row.values()) for row in rows)):
                raise ProviderError("Pesos lexicais BGE-M3 inválidos.")
            weights.extend(rows)
        return (np.concatenate(vectors) if vectors else np.empty((0, self.dimensions), dtype=np.float32)), weights

    def encode(self, texts):
        return self._encode(texts, self.document_prefix)

    def encode_query(self, texts):
        return self._encode(texts, self.query_prefix)


def describe_remote_embedding(identity, settings):
    if settings is not None:
        identity["models"]["embedding"] = {
            "provider": "spark_nemotron_dense_bge_sparse", "model": settings.embedding_model,
            "dimensions": RemoteHybridEncoder.dimensions, "lexical_model": RemoteHybridEncoder.lexical_model,
            "lexical_revision": settings.lexical_revision,
        }
    return identity


class MacExactDenseSearch:
    """Exact inner products without invoking the second OpenMP runtime on macOS."""

    def __init__(self, dense):
        self.vectors = dense.index.reconstruct_n()
        self.chunks = dense.chunks
        self.last_search = {}

    def search(self, vector, scope, k):
        from time import perf_counter

        started = perf_counter()
        query = np.asarray(vector, dtype=np.float32).reshape(-1)
        if query.shape != (self.vectors.shape[1],) or not np.isfinite(query).all():
            raise ValueError("Invalid query vector")
        norm = np.linalg.norm(query)
        if norm:
            query = query / norm
        allowed = None if scope is None else set(scope)
        positions = [i for i, chunk in enumerate(self.chunks)
                     if allowed is None or chunk.document_id in allowed]
        scores = self.vectors[positions] @ query if positions and k > 0 else []
        rows = sorted(zip(positions, map(float, scores)),
                      key=lambda item: (-item[1], self.chunks[item[0]].chunk_id))[:max(0, k)]
        self.last_search = {
            "strategy": "exact_numpy", "allowed_count": len(positions),
            "subset_cache_hit": False, "subset_cache_bytes": 0,
            "latency_seconds": perf_counter() - started,
        }
        return rows
