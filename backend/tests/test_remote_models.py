from types import SimpleNamespace

import numpy as np
import pytest

from qwenrag.remote_models import (
    MacExactDenseSearch, ProviderError, RemoteChatTokenizer, RemoteHybridEncoder,
)


def test_tokenizer_sends_same_chat_template_options(monkeypatch):
    tokenizer = RemoteChatTokenizer("http://localhost:18000/v1", "qwen", 5)
    messages = [{"role": "user", "content": "olá"}]

    def call(path, payload):
        assert tokenizer.client.url == "http://localhost:18000"
        assert path == "/tokenize"
        assert payload == {"model": "qwen", "messages": messages, "add_generation_prompt": True,
                           "chat_template_kwargs": {"enable_thinking": False}}
        return {"count": 2, "tokens": [1, 2]}

    monkeypatch.setattr(tokenizer.client, "call", call)
    assert tokenizer.apply_chat_template(messages, tokenize=True, add_generation_prompt=True,
                                         enable_thinking=False) == [1, 2]


def test_embeddings_keep_order_and_reject_incompatible_vectors(monkeypatch):
    encoder = object.__new__(RemoteHybridEncoder)
    encoder.model = "nemotron"
    vectors = np.eye(2, encoder.dimensions).tolist()
    encoder.dense = SimpleNamespace(call=lambda path, payload: {
        "model": "nemotron", "data": [{"index": i, "embedding": vectors[i]} for i in [1, 0]],
    })
    np.testing.assert_array_equal(encoder._vectors(["a", "b"], "query: "), vectors)
    vectors[0] = [1, 0]
    with pytest.raises(ProviderError, match="incompatíveis"):
        encoder._vectors(["a", "b"], "query: ")


def test_exact_macos_search_preserves_scope_and_tie_order():
    chunks = [SimpleNamespace(document_id=d, chunk_id=c) for d, c in [("one", "b"), ("one", "a"), ("two", "c")]]
    vectors = np.asarray([[1, 0], [1, 0], [0, 1]], dtype=np.float32)
    dense = MacExactDenseSearch(SimpleNamespace(chunks=chunks, index=SimpleNamespace(reconstruct_n=lambda: vectors)))
    assert dense.search([5, 0], ["one"], 2) == [(1, 1.0), (0, 1.0)]
    assert dense.search([5, 0], [], 2) == []
    assert dense.search([0, 1], None, 1) == [(2, 1.0)]
