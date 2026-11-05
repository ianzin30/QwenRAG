import pytest
from rag_ufc_core.rag.v2.Providers import ProviderError

from conftest import make_settings
from qwenrag.core_runtime import CoreRuntime
from qwenrag.remote_reranker import RemoteReranker
from qwenrag.settings import RemoteRerankerSettings


REMOTE = {"base_url": "http://127.0.0.1:18006", "model": "nvidia/Nemotron-3.5-Rerank-8B-BF16"}


def test_scores_follow_candidate_order_even_across_request_boundaries(monkeypatch):
    adapter = RemoteReranker(RemoteRerankerSettings(**REMOTE))
    counts = []

    def request(path, payload):
        assert path == "/v1/rerank" and payload["model"] == REMOTE["model"]
        docs = payload["documents"]
        counts.append(len(docs))
        return {"results": [{"index": i, "relevance_score": float(docs[i])}
                            for i in reversed(range(len(docs)))]}

    monkeypatch.setattr(adapter, "_request", request)
    assert adapter.score("q", [str(i) for i in range(63)]) == list(range(63))
    assert counts == [60, 3]


def test_incomplete_remote_response_fails_without_local_fallback(monkeypatch):
    adapter = RemoteReranker(RemoteRerankerSettings(**REMOTE))
    monkeypatch.setattr(adapter, "_request", lambda *args: {"results": []})
    with pytest.raises(ProviderError, match="todos os trechos"):
        adapter.score("q", ["candidate"])


def test_remote_configuration_identifies_effective_model(tmp_path, no_network):
    core = CoreRuntime(make_settings(tmp_path, reranker=REMOTE, allow_divergent_pipeline=True))
    assert core.identity["models"]["reranker"]["model"] == REMOTE["model"]
    assert core.adoption["status"] == "divergent"
