"""Text reranking on Spark, behind the core's score(query, texts) contract."""
import json
import math
import sys
from urllib.request import Request, urlopen

from rag_ufc_core import RAGService
from rag_ufc_core.rag.v2.Engine import RAGEngine
from rag_ufc_core.rag.v2.Providers import ProviderError
from rag_ufc_core.rag.v2.Spark import SparkProvider

from .remote_models import (
    MacExactDenseSearch, RemoteChatTokenizer, RemoteHybridEncoder, describe_remote_embedding,
)


class RemoteReranker:
    max_documents = 60

    def __init__(self, settings):
        self.base_url = str(settings.base_url).rstrip("/")
        self.model = settings.model
        self.timeout = settings.timeout_seconds

    def _request(self, path, payload=None):
        try:
            req = Request(
                self.base_url + path,
                data=None if payload is None else json.dumps(payload, ensure_ascii=False).encode(),
                headers={"Content-Type": "application/json"} if payload is not None else {},
            )
            with urlopen(req, timeout=self.timeout) as response:
                result = json.load(response)
        except (OSError, ValueError) as exc:
            raise ProviderError(
                "O reranker da Spark não respondeu corretamente. Confira o túnel SSH e o serviço Nemotron."
            ) from exc
        if not isinstance(result, dict) or result.get("model") != self.model:
            raise ProviderError("A Spark retornou um reranker diferente do configurado.")
        return result

    def check_ready(self):
        if self._request("/health").get("status") != "ok":
            raise ProviderError("O reranker da Spark não está pronto.")

    def score(self, query, texts):
        scores = []
        for start in range(0, len(texts), self.max_documents):
            documents = list(texts[start:start + self.max_documents])
            result = self._request("/v1/rerank", {
                "model": self.model, "query": query, "documents": documents,
            })
            aligned = {}
            rows = result.get("results")
            if not isinstance(rows, list):
                raise ProviderError("A Spark retornou pontuações de reranking inválidas.")
            for row in rows:
                idx = row.get("index") if isinstance(row, dict) else None
                value = row.get("relevance_score") if isinstance(row, dict) else None
                if (type(idx) is not int or not 0 <= idx < len(documents) or idx in aligned
                        or type(value) not in (int, float) or not math.isfinite(value)):
                    raise ProviderError("A Spark retornou pontuações de reranking inválidas.")
                aligned[idx] = float(value)
            if len(aligned) != len(documents):
                raise ProviderError("A Spark não pontuou todos os trechos candidatos.")
            scores.extend(aligned[i] for i in range(len(documents)))
        return scores


def create_remote_service(engine_settings, paths, model_name, core):
    """Use the pinned core's engine_factory hook; isolate the retriever seam here."""
    def spark_factory(selection, config):
        provider = SparkProvider(selection, config)
        provider.tokenizer = RemoteChatTokenizer(provider.base_url, selection.model, config.timeout_seconds)
        return provider

    class SparkBackedEngine(RAGEngine):
        def __init__(self, facade, llm_config, config):
            super().__init__(facade, llm_config, config)
            self.configure_providers()

        def configure_providers(self):
            if core.spark_tokenization:
                self.providers.factories["spark"] = spark_factory

        def set_model(self, model):
            super().set_model(model)
            self.configure_providers()

        def load_collection(self, selection):
            if self.encoder is None and core.spark_retrieval is not None:
                self.encoder = RemoteHybridEncoder(self.config, core.spark_retrieval)
            result = super().load_collection(selection)
            if core.spark_retrieval is not None and sys.platform == "darwin":
                self.retriever.dense = MacExactDenseSearch(self.retriever.dense)
            # The BGE wrapper is lazy; replace it before readiness or scoring.
            if core.reranker is not None:
                self.retriever.reranker = RemoteReranker(core.reranker)
            return result

    class SparkBackedService(RAGService):
        def check_ready(self):
            diagnostics = super().check_ready()
            if core.reranker is not None:
                self._v2.retriever.reranker.check_ready()
            return diagnostics

        def pipeline_identity(self):
            return describe_remote_embedding(super().pipeline_identity(), core.spark_retrieval)

    return SparkBackedService(
        engine_settings, paths, model_name=model_name, engine_factory=SparkBackedEngine,
    )
