"""Upload → index → question through the real rag-ufc-core facade.

Only the parts that need models or the network are replaced: the encoder (a
deterministic bag of words), readiness checks against the model server, and the
generation step, which returns a trace citing a real indexed chunk. Ingestion,
chunking, index caching under the application's data root, collection handling,
citation normalization and identity are the core's own code.
"""
import json
import re
import sys
import uuid

import numpy as np
from fastapi.testclient import TestClient
from rag_ufc_core import RAGService
from rag_ufc_core.rag.v2.Engine import RAGEngine
from rag_ufc_core.strategies import experimental_modules

from qwenrag.core_runtime import CoreRuntime
from qwenrag.server import create_app

from conftest import MODEL


class WordTokenizer:
    name_or_path = "test/word-tokenizer"

    def __call__(self, text, **kwargs):
        return {"offset_mapping": [(m.start(), m.end()) for m in re.finditer(r"\S+", text)]}


class HashEncoder:
    identity = {"provider": "test", "model": "hash-encoder", "dimensions": 16}
    tokenizer = WordTokenizer()

    def encode(self, texts):
        vectors = []
        for text in texts:
            vector = np.full(16, 1e-3, dtype="float32")
            for word in re.findall(r"\w+", text.lower()):
                vector[sum(map(ord, word)) % 16] += 1.0
            vectors.append(vector)
        return np.asarray(vectors), [{w: 1.0 for w in re.findall(r"\w+", t.lower())} for t in texts]


class OfflineEngine(RAGEngine):
    def __init__(self, facade, llm_config, config):
        super().__init__(facade, llm_config, config)
        self.encoder = HashEncoder()

    def ask(self, question, history=None, diagnostics=False):
        for stage in ("planning", "retrieval", "answer"):
            self.facade._emit_response_status(stage, stage)
        chunk = next(c for c in self.retriever.chunks if "março" in c.text)
        claim = "As aulas começam em março."
        evidence = {"evidence_id": "E1", "chunk_id": chunk.chunk_id, "parent_id": chunk.parent_id,
                    "document_name": chunk.document_name, "chunk_kind": chunk.chunk_kind, "excerpt": chunk.text,
                    "source": str(self.facade.collections_root / chunk.relative_path),
                    "relative_path": chunk.relative_path}
        return {"trace_version": 2, "status": "answered", "route": "retrieval", "resolved_question": question,
                "answer_text": claim, "claims": [{"claim_id": "c1", "text": claim, "evidence_ids": ["E1"]}],
                "evidence": [evidence], "sources": [],
                "cited_sources": [{**evidence, "section_title": chunk.section_title, "provenance": [],
                                   "claim_ids": ["c1"], "focus_spans": []}],
                "provider_calls": []}


class OfflineService(RAGService):
    def check_model_ready(self):
        pass  # would list models on the Spark server

    def check_ready(self):
        return self._v2.load_diagnostics  # would load the cross-encoder


def sse(body):
    return [(dict(l.split(": ", 1) for l in block.splitlines())["event"],
             json.loads(dict(l.split(": ", 1) for l in block.splitlines())["data"]))
            for block in body.split("\n\n") if block.strip() and not block.startswith(":")]


def test_upload_index_and_answer_through_the_core(settings):
    core = CoreRuntime(settings)

    def factory(model_name):
        return OfflineService(core.engine_settings, core.paths, model_name=model_name, engine_factory=OfflineEngine)

    with TestClient(create_app(settings, core=core, service_factory=factory, keep_alive_seconds=0.05)) as client:
        upload = client.post("/api/uploads", data={"collection": "uploaded_files"},
                             files=[("files", ("calendario.txt", "O semestre começa em março.".encode(), "text/plain"))])
        events = sse(client.get(f"/api/uploads/{upload.json()['job_id']}/events").text)
        assert events[-1][0] == "upload.completed"
        [document] = events[-1][1]["saved"]
        extract = settings.collections_root / document["relative_path"]
        assert extract.read_text(encoding="utf-8").startswith("# calendario.txt\n\nExtraction method: docling\n")

        chat = client.post("/api/conversations", json={"collection": ["uploaded_files"], "model": MODEL}).json()["id"]
        turn = client.post(f"/api/conversations/{chat}/turns",
                           json={"client_turn_id": uuid.uuid4().hex, "question": "Quando começa?", "model": MODEL})
        events = sse(turn.text)
        assert [n for n, _ in events][0] == "turn.accepted" and events[-1][0] == "turn.completed"
        assert "indexing" in [d["stage"] for n, d in events if n == "turn.progress"]
        message = events[-1][1]["message"]
        assert message["claims"][0]["evidence_ids"] == ["E1"]
        assert message["cited_sources"][0]["document_id"] == document["id"]
        assert message["profile"]["pipeline"]["core_version"] == core.identity["core_version"]
        assert message["profile"]["pipeline"]["adoption_status"] == "approved_match"

        [index] = list((settings.data_root / "cache" / "rag_v2").glob("*.npz"))
        diagnostics = client.get("/api/diagnostics/pipeline").json()
        assert diagnostics["indexes"][0]["index_fingerprint"] == index.stem

    stored = json.loads(settings.conversations_path.read_text())["chat_sessions"][0]["turns"][0]
    assert stored["profile"]["pipeline"]["pipeline_signature"] == core.identity["pipeline_signature"]
    assert stored["profile"]["index"]["fingerprint"] == index.stem
    loaded = {name.rsplit(".", 1)[-1] for name in sys.modules if name.startswith("rag_ufc_core.rag.v2.")}
    assert not loaded & experimental_modules()
