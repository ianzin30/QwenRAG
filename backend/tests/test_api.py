"""HTTP layer for the React frontend: routes, SSE framing, idempotency and public errors.

Ported from RAG-UFC's API tests. RAGService and the upload service are fakes; nothing
loads models or opens sockets. The core release check runs for real.
"""
import json
from pathlib import Path
import threading
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from qwenrag.api.events import format_event
from qwenrag.server import create_app

from conftest import MODEL

DOC = "uploaded_files/01_calendario.md"


def trace(question):
    excerpt = "As aulas começam em 3 de março."
    return {
        "trace_version": 2, "status": "answered", "route": "retrieval", "resolved_question": question,
        "answer_text": "As aulas começam em 3 de março. [E1]",
        "claims": [{"claim_id": "c1", "text": "As aulas começam em 3 de março.", "evidence_ids": ["E1"]}],
        "sources": [], "provider_calls": [{"role": "answer", "status": "ok", "endpoint": "http://internal"}],
        "cited_sources": [{
            "evidence_id": "E1", "document_name": "calendario", "chunk_kind": "text", "excerpt": excerpt,
            "source": "/abs/server/path/calendario.md", "source_name": "calendario.md", "relative_path": DOC,
            "section_title": "Calendário", "provenance": [{"page_no": 3}], "claim_ids": ["c1"],
            "focus_spans": [{"start": 0, "end": 9, "quote": excerpt[:9], "claim_ids": ["c1"]}],
        }],
    }


class FakeService:
    created = []
    asked = []
    behaviour = {}

    def __init__(self, model_name=None):
        self.model_name = model_name
        self.collection_cb = self.status_cb = None
        FakeService.created.append(self)

    def set_collection_progress_callback(self, cb):
        self.collection_cb = cb

    def set_response_status_callback(self, cb):
        self.status_cb = cb

    def check_model_ready(self):
        if FakeService.behaviour.get("prepare_error"):
            raise FakeService.behaviour["prepare_error"]

    def load_collection(self, names):
        self.collection_cb({"event": "index_embedding_progress", "completed": 1, "total": 2})

    def check_ready(self):
        return {}

    def ask_question_with_trace(self, question, history):
        FakeService.asked.append((question, history))
        for stage in ("planning", "retrieval", "reasoning", "answer"):
            self.status_cb({"stage": stage, "message": stage, "mode": None, "agent": None})
        if FakeService.behaviour.get("sleep"):
            time.sleep(FakeService.behaviour["sleep"])
        if FakeService.behaviour.get("error"):
            raise FakeService.behaviour["error"]
        return FakeService.behaviour.get("trace", trace)(question)


class FakeUploads:
    def __init__(self, root):
        self.root = root

    def ingest_uploaded_files(self, files, collection_name, progress_callback):
        total = len(files)
        progress_callback({"status": "queued", "processed": 0, "total": total})
        saved, skipped = [], []
        for index, f in enumerate(files, start=1):
            progress_callback({"status": "extracting", "processed": index - 1, "total": total, "file_name": f.name})
            if not f.getvalue():
                skipped.append({"name": f.name, "reason": "empty file"})
                progress_callback({"status": "skipped", "processed": index, "total": total, "file_name": f.name, "reason": "empty file"})
                continue
            out = self.root / collection_name / f"{10 + index:02d}_{Path(f.name).stem}.md"
            out.write_text(f"# {f.name}\n\n{f.getvalue().decode()}\n", encoding="utf-8")
            saved.append({"name": f.name, "output_path": str(out)})
            progress_callback({"status": "saved", "processed": index, "total": total, "file_name": f.name})
        if not saved:
            raise RuntimeError("No uploaded files could be processed (empty file).")
        return {"collection_name": collection_name, "files": saved, "skipped_files": skipped}


@pytest.fixture
def env(settings):
    root = settings.collections_root
    (root / "uploaded_files").mkdir(parents=True)
    (root / DOC).write_text("# calendario.pdf\n\nAs aulas começam em 3 de março.\n", encoding="utf-8")
    (root / DOC).with_suffix(".structure.json").write_text("{}", encoding="utf-8")
    FakeService.created, FakeService.asked, FakeService.behaviour = [], [], {}
    app = create_app(settings, service_factory=FakeService, upload_service_factory=lambda: FakeUploads(root),
                     keep_alive_seconds=0.05)
    with TestClient(app) as client:
        yield client, root


def parse_sse(body):
    events, comments = [], []
    for block in body.split("\n\n"):
        if not block.strip():
            continue
        if block.startswith(":"):
            comments.append(block)
            continue
        fields = dict(line.split(": ", 1) for line in block.splitlines())
        events.append((fields["event"], json.loads(fields["data"])))
    return events, comments


def new_chat(client):
    response = client.post("/api/conversations", json={"collection": ["uploaded_files"], "model": MODEL})
    assert response.status_code == 201, response.json()
    return response.json()["id"]


def ask(client, chat_id, question="Quando começam as aulas?", turn_id=None):
    turn_id = turn_id or uuid.uuid4().hex
    response = client.post(f"/api/conversations/{chat_id}/turns", headers={"Accept": "text/event-stream"},
                           json={"client_turn_id": turn_id, "question": question, "model": MODEL, "collection": ["uploaded_files"]})
    return response, turn_id


def test_format_event_is_one_json_data_line():
    frame = format_event("turn.progress", {"label": "linha 1\nlinha 2", "stage": "retrieving"})
    assert frame.endswith("\n\n") and frame.count("\n") == 3
    assert frame.startswith("event: turn.progress\ndata: ")
    assert json.loads(frame.split("data: ", 1)[1]) == {"label": "linha 1\nlinha 2", "stage": "retrieving"}


def test_config_and_collections(env):
    client, _ = env
    config = client.get("/api/config").json()
    assert any(m["model_name"] == MODEL and m["is_default"] for m in config["models"])
    assert "pdf" in config["upload_types"] and config["max_upload_bytes"] == 200 * 1024 * 1024
    assert config["features"] == {"drive_import": False, "cancel_turn": False}
    assert client.get("/api/collections").json() == [{"name": "uploaded_files", "document_count": 1}]


def test_documents_use_opaque_ids_and_delete_removes_sidecar(env):
    client, root = env
    [document] = client.get("/api/documents").json()
    assert document["id"].startswith("doc_") and "/" not in document["id"]
    assert document["file_name"] == "calendario.pdf" and document["relative_path"] == DOC
    assert client.get("/api/documents", params={"collection": "outra"}).json() == []
    content = client.get(f"/api/documents/{document['id']}/content")
    assert content.headers["content-type"].startswith("text/markdown") and "3 de março" in content.text
    assert client.get("/api/documents/..%2F..%2Fetc%2Fpasswd/content").status_code == 404
    assert client.delete(f"/api/documents/{document['id']}").status_code == 204
    assert not (root / DOC).exists() and not (root / DOC).with_suffix(".structure.json").exists()
    missing = client.delete(f"/api/documents/{document['id']}")
    assert missing.status_code == 404 and missing.json()["code"] == "document_not_found"


def test_conversation_crud_and_limit(env):
    client, _ = env
    ids = [new_chat(client) for _ in range(6)]
    listed = client.get("/api/conversations").json()
    assert {c["id"] for c in listed} == set(ids) and listed[0]["collection"] == ["uploaded_files"]
    assert len({c["title"] for c in listed}) == 6  # "Nova conversa", "Nova conversa 2", ...
    limit = client.post("/api/conversations", json={})
    assert limit.status_code == 409 and "6 chats" in limit.json()["detail"]
    assert client.delete(f"/api/conversations/{ids[0]}").status_code == 204
    assert client.delete(f"/api/conversations/{ids[0]}").status_code == 404
    assert client.get(f"/api/conversations/{ids[0]}/messages").status_code == 404


def test_turn_streams_progress_then_completed_and_persists(env):
    client, _ = env
    chat_id = new_chat(client)
    response, turn_id = ask(client, chat_id)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache" and response.headers["x-accel-buffering"] == "no"
    events, _ = parse_sse(response.text)
    names = [name for name, _ in events]
    assert names[0] == "turn.accepted" and names[-1] == "turn.completed" and "turn.failed" not in names
    assert events[0][1] == {"turn_id": turn_id, "user_message_id": f"{turn_id}-user"}
    stages = [data["stage"] for name, data in events if name == "turn.progress"]
    assert stages == ["indexing", "analyzing", "retrieving", "reranking", "generating"]
    indexing = events[1][1]
    assert indexing["current"] == 1 and indexing["total"] == 2 and "embeddings" in indexing["label"]

    message = events[-1][1]["message"]
    assert message["turn_id"] == turn_id and message["turn_state"] == "answered" and message["id"] == f"{turn_id}-assistant"
    assert message["claims"] == [{"claim_id": "c1", "text": "As aulas começam em 3 de março.", "evidence_ids": ["E1"]}]
    [source] = message["cited_sources"]
    assert source["evidence_id"] == "E1" and source["provenance"] == [{"page_no": 3}] and source["source_id"]
    assert source["document_id"] == client.get("/api/documents").json()[0]["id"]
    assert "source" not in source and "source_name" not in source  # no server paths
    assert message["profile"]["llm"]["model"] == MODEL and message["profile"]["llm"]["label"]
    assert message["execution"] == {"logical_calls": 1, "transport_attempts": 1}  # no internal endpoints
    assert "duration_ms" in message

    stored = client.get(f"/api/conversations/{chat_id}/messages").json()
    assert [(m["role"], m["id"]) for m in stored] == [("user", f"{turn_id}-user"), ("assistant", f"{turn_id}-assistant")]
    assert stored[0]["turn_state"] == "answered" and stored[1]["cited_sources"][0]["document_id"] == source["document_id"]
    assert client.get("/api/conversations").json()[0]["title"] == "Quando começam as aulas?"

    ask(client, chat_id, "E quando terminam?")
    assert len(FakeService.created) == 1  # the prepared service is reused
    assert FakeService.asked[-1][1][0] == {"role": "user", "content": "Quando começam as aulas?"}


def test_same_client_turn_id_never_runs_twice(env):
    client, _ = env
    chat_id = new_chat(client)
    first, turn_id = ask(client, chat_id)
    again, _ = ask(client, chat_id, turn_id=turn_id)
    assert parse_sse(again.text)[0] == parse_sse(first.text)[0]
    assert len(FakeService.asked) == 1
    other = ask(client, new_chat(client), turn_id=turn_id)[0]
    assert other.status_code == 409 and other.json()["code"] == "turn_conflict"
    # Replay from storage too (e.g. after an API restart, when the in-memory job is gone).
    client.app.state.turn_jobs.clear()
    replay, _ = ask(client, chat_id, turn_id=turn_id)
    events, _ = parse_sse(replay.text)
    assert [n for n, _ in events] == ["turn.accepted", "turn.completed"] and len(FakeService.asked) == 1
    assert len(client.get(f"/api/conversations/{chat_id}/messages").json()) == 2


@pytest.mark.parametrize("error, outcome, text", [
    (ConnectionError("socket reset at 10.0.0.1"), "unknown", "Resultado remoto desconhecido"),
    (KeyError("internal detail"), "failed", "Não foi possível concluir a resposta"),
])
def test_turn_failures_use_public_messages(env, error, outcome, text):
    client, _ = env
    FakeService.behaviour["error"] = error
    chat_id = new_chat(client)
    response, turn_id = ask(client, chat_id)
    events, _ = parse_sse(response.text)
    name, data = events[-1]
    assert name == "turn.failed" and data["outcome"] == outcome and text in data["message"]
    assert "10.0.0.1" not in response.text and "internal detail" not in response.text and "Traceback" not in response.text
    [user] = client.get(f"/api/conversations/{chat_id}/messages").json()
    assert user["turn_state"] == outcome and text in user["error"]
    # A stored failure is replayed, never re-executed (unknown must never be re-sent).
    client.app.state.turn_jobs.clear()
    replay, _ = ask(client, chat_id, turn_id=turn_id)
    assert parse_sse(replay.text)[0][-1][1]["outcome"] == outcome and len(FakeService.asked) == 1


def test_preparation_failure_is_reported_as_failed(env):
    client, _ = env
    FakeService.behaviour["prepare_error"] = OSError("/secret/index missing")
    response, _ = ask(client, new_chat(client))
    name, data = parse_sse(response.text)[0][-1]
    assert name == "turn.failed" and data["outcome"] == "failed" and "preparar o modelo" in data["message"]
    assert "/secret" not in response.text


def test_long_turn_sends_keep_alive_comments(env):
    client, _ = env
    FakeService.behaviour["sleep"] = 0.3
    response, _ = ask(client, new_chat(client))
    events, comments = parse_sse(response.text)
    assert comments and all(c == ": ping" for c in comments)
    assert events[-1][0] == "turn.completed"


def test_partial_preamble_becomes_uncited_claim(env):
    client, _ = env

    def partial(question):
        result = trace(question)
        result.update(status="partial", answer_text="Resposta parcial — falta: data final.\n\nAs aulas começam em 3 de março. [E1]")
        return result
    FakeService.behaviour["trace"] = partial
    response, _ = ask(client, new_chat(client))
    message = parse_sse(response.text)[0][-1][1]["message"]
    assert message["turn_state"] == "partial"
    assert message["claims"][0] == {"claim_id": "preamble", "text": "Resposta parcial — falta: data final.", "evidence_ids": []}


def test_turn_validation_errors_are_json_before_any_event(env):
    client, root = env
    chat_id = new_chat(client)
    bad = client.post(f"/api/conversations/{chat_id}/turns", json={"client_turn_id": "x", "question": "oi"})
    assert bad.status_code == 400 and bad.json()["code"] == "invalid_client_turn_id"
    unknown_model = client.post(f"/api/conversations/{chat_id}/turns",
                                json={"client_turn_id": uuid.uuid4().hex, "question": "oi", "model": "nao-existe"})
    assert unknown_model.status_code == 400 and unknown_model.json()["code"] == "model_unavailable"
    missing = client.post("/api/conversations/chat_nope/turns", json={"client_turn_id": uuid.uuid4().hex, "question": "oi"})
    assert missing.status_code == 404
    (root / DOC).unlink()
    empty = client.post(f"/api/conversations/{chat_id}/turns", json={"client_turn_id": uuid.uuid4().hex, "question": "oi"})
    assert empty.status_code == 409 and empty.json()["code"] == "no_documents"
    assert FakeService.asked == []


def test_running_turn_blocks_delete_and_second_question(env):
    client, _ = env
    FakeService.behaviour["sleep"] = 0.5
    chat_id = new_chat(client)
    worker = threading.Thread(target=ask, args=(client, chat_id))
    worker.start()
    time.sleep(0.25)
    assert client.delete(f"/api/conversations/{chat_id}").status_code == 409
    second, _ = ask(client, chat_id, "outra")
    assert second.status_code == 409
    worker.join()
    store = client.app.state.store
    assert store.active_turns.isdisjoint(t["turn_id"] for t in store.load()["chat_sessions"][0]["turns"])


def test_upload_job_streams_progress_and_saved_documents(env):
    client, root = env
    files = [("files", ("notas.txt", b"conteudo", "text/plain")), ("files", ("vazio.txt", b"", "text/plain"))]
    response = client.post("/api/uploads", data={"collection": "uploaded_files"}, files=files)
    assert response.status_code == 202
    job_id = response.json()["job_id"]
    events, _ = parse_sse(client.get(f"/api/uploads/{job_id}/events").text)
    assert events[0] == ("upload.progress", {"files": [
        {"file_name": "notas.txt", "phase": "queued", "percent": 30}, {"file_name": "vazio.txt", "phase": "queued", "percent": 30}]})
    last_progress = [d for n, d in events if n == "upload.progress"][-1]["files"]
    assert last_progress[0]["phase"] == "done" and last_progress[1] == {
        "file_name": "vazio.txt", "phase": "skipped", "percent": 100, "message": "empty file"}
    name, done = events[-1]
    assert name == "upload.completed"
    assert [d["file_name"] for d in done["saved"]] == ["notas.txt"] and done["saved"][0]["id"].startswith("doc_")
    assert done["skipped"] == [{"file_name": "vazio.txt", "reason": "empty file"}]
    assert len(client.get("/api/documents").json()) == 2
    # Events can be read again (e.g. a reconnecting client).
    assert parse_sse(client.get(f"/api/uploads/{job_id}/events").text)[0][-1][0] == "upload.completed"


def test_upload_failures(env):
    client, _ = env
    failed = client.post("/api/uploads", data={"collection": "uploaded_files"}, files=[("files", ("vazio.txt", b"", "text/plain"))])
    name, data = parse_sse(client.get(f"/api/uploads/{failed.json()['job_id']}/events").text)[0][-1]
    assert name == "upload.failed" and "No uploaded files" in data["message"]
    traversal = client.post("/api/uploads", data={"collection": "../fora"}, files=[("files", ("a.txt", b"x", "text/plain"))])
    assert traversal.status_code == 400
    assert client.get("/api/uploads/nope/events").status_code == 404


def test_root_explains_the_api_when_the_frontend_is_not_built(env):
    client, _ = env
    response = client.get("/")
    assert response.status_code == 200 and "/api/docs" in response.text


def test_root_serves_the_built_frontend(settings):
    from dataclasses import replace

    dist = settings.data_root.parent / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><div id=root>QwenRAG UI</div>", encoding="utf-8")
    app = create_app(replace(settings, frontend_dist=dist), service_factory=FakeService)
    with TestClient(app) as client:
        page = client.get("/")
        assert "QwenRAG UI" in page.text and page.headers["cache-control"] == "no-cache"
        assert client.get("/api/config").status_code == 200
