"""The application runs the pinned, approved core pipeline, or refuses to start."""
import json

import pytest
from fastapi.testclient import TestClient

from qwenrag.core_runtime import CoreAdoptionError, CoreRuntime
from qwenrag.server import create_app

from conftest import MODEL, make_settings


def test_approved_release_starts_and_reports_its_identity(settings):
    core = CoreRuntime(settings)
    assert core.adoption["status"] == "approved_match"
    with TestClient(create_app(settings, core=core)) as client:
        response = client.get("/api/diagnostics/pipeline")
    body = response.json()
    assert body["adoption"]["status"] == "approved_match"
    assert body["release"]["approval_status"] in {"approved", "baseline_continuity"}
    assert body["core"]["version"] == json.loads(settings.lock_path.read_text())["core_version"]
    assert body["pipeline"]["pipeline_signature"] == core.identity["pipeline_signature"]
    assert body["pipeline"]["models"]["generation"]["model"] == MODEL
    assert isinstance(body["adoption"]["environment_differences"], list)
    # Diagnostics never expose endpoints, credential variable names or server paths.
    for secret_like in ("spark.ollama", "LLM_API_KEY", "localhost:11434", str(settings.data_root)):
        assert secret_like not in response.text


def test_pipeline_overrides_refuse_to_start_unless_explicitly_allowed(tmp_path, no_network):
    overrides = {"retrieval": {"rerank_k": 10}}
    with pytest.raises(CoreAdoptionError, match="pipeline_config.retrieval.rerank_k"):
        CoreRuntime(make_settings(tmp_path, overrides=overrides))
    core = CoreRuntime(make_settings(tmp_path, overrides=overrides, allow_divergent_pipeline=True))
    assert core.adoption["status"] == "divergent"
    assert core.turn_profile(MODEL)["pipeline"]["adoption_status"] == "divergent"


def test_deployment_section_cannot_smuggle_pipeline_changes(tmp_path, no_network):
    with pytest.raises(ValueError, match="llm.temperature"):
        CoreRuntime(make_settings(tmp_path, deployment={"llm": {"temperature": 0.5}}))


def test_installed_core_must_match_the_lock(tmp_path, no_network):
    settings = make_settings(tmp_path)
    lock = json.loads(settings.lock_path.read_text())
    settings.lock_path.write_text(json.dumps({**lock, "core_source_fingerprint": "f" * 64}))
    with pytest.raises(CoreAdoptionError, match="pin_mismatch"):
        CoreRuntime(settings)
    settings.lock_path.write_text(json.dumps({**lock, "release_manifest_sha256": "0" * 64}))
    with pytest.raises(CoreAdoptionError, match="release_manifest_sha256"):
        CoreRuntime(settings)
    from qwenrag.core_lock import installed_commit
    if installed_commit():  # installed from git: the commit itself is pinned
        settings.lock_path.write_text(json.dumps({**lock, "source": {**lock["source"], "commit": "f" * 40}}))
        with pytest.raises(CoreAdoptionError, match="installed core commit"):
            CoreRuntime(settings)


def test_models_outside_the_approved_pipeline_are_refused(tmp_path, no_network):
    import tomllib
    from pathlib import Path

    from qwenrag.settings import AppSettings

    settings = make_settings(tmp_path)
    raw = tomllib.loads((Path(__file__).resolve().parents[2] / "config/qwenrag.toml").read_text())
    raw.update(data_root=str(settings.data_root), env_file=str(settings.env_file))
    raw["core"]["lock"] = str(settings.lock_path)
    raw["models"].append({"model_name": "other/model", "label": "Other"})
    with pytest.raises(CoreAdoptionError, match="other/model"):
        CoreRuntime(AppSettings.from_mapping(raw, base=settings.config_path.parent))


def test_secrets_come_from_env_file_but_exported_variables_win(settings, monkeypatch):
    from rag_ufc_core.secret_source import read_secret

    settings.env_file.write_text("LLM_API_KEY=from-file\nOTHER_SECRET=only-file\n", encoding="utf-8")
    monkeypatch.setenv("LLM_API_KEY", "from-process")
    CoreRuntime(settings)
    assert read_secret("LLM_API_KEY") == "from-process"
    assert read_secret("OTHER_SECRET") == "only-file"
    assert read_secret("MISSING_SECRET") == ""


def _config_file(tmp_path, settings, extra=""):
    from pathlib import Path

    text = (Path(__file__).resolve().parents[2] / "config/qwenrag.toml").read_text(encoding="utf-8")
    text = text.replace('data_root = "../data"', f'data_root = "{tmp_path / "data"}"')
    text = text.replace('env_file = "../.env"', f'env_file = "{tmp_path / ".env"}"')
    text = text.replace('lock = "../core-release.lock.json"', f'lock = "{settings.lock_path}"')
    path = tmp_path / "qwenrag.toml"
    path.write_text(text + extra, encoding="utf-8")
    return path


def test_check_command_prints_identity_or_refuses(tmp_path, settings, capsys):
    from qwenrag.__main__ import main

    assert main(["--check", "--config", str(_config_file(tmp_path, settings))]) == 0
    printed = json.loads(capsys.readouterr().out)
    assert printed["adoption"]["status"] == "approved_match"
    divergent = _config_file(tmp_path, settings, '\n[core.overrides.retrieval]\nsearch_k = 5\n')
    assert main(["--check", "--config", str(divergent)]) == 2
    assert "pipeline_config.retrieval.search_k" in capsys.readouterr().err


def test_committed_lock_matches_the_installed_core(no_network):
    """CI guard: bumping the dependency without re-adopting (core_lock) fails here."""
    from pathlib import Path

    from qwenrag.core_lock import installed_commit
    from qwenrag.core_runtime import lock_problems, read_lock

    lock = read_lock(Path(__file__).resolve().parents[2] / "core-release.lock.json")
    assert lock_problems(lock) == []
    from rag_ufc_core.identity import core_source_fingerprint
    assert lock["core_source_fingerprint"] == core_source_fingerprint()
    if installed_commit():
        assert lock["source"]["commit"] == installed_commit()


def test_configuration_is_found_from_repository_or_backend_and_never_defaulted(tmp_path, monkeypatch):
    from pathlib import Path

    from qwenrag.settings import AppSettings

    repository = Path(__file__).resolve().parents[2]
    monkeypatch.delenv("QWENRAG_CONFIG", raising=False)
    for cwd in (repository, repository / "backend"):
        monkeypatch.chdir(cwd)
        settings = AppSettings.load()
        assert settings.config_path == repository / "config/qwenrag.toml"
        assert settings.lock_path == repository / "core-release.lock.json"
    monkeypatch.chdir(tmp_path)
    with pytest.raises(FileNotFoundError):
        AppSettings.load()


def test_default_service_factory_builds_the_core_facade_for_the_approved_pipeline(settings):
    """The production path (no injected factory) constructs the real RAGService; nothing is loaded."""
    from rag_ufc_core import RAGService

    core = CoreRuntime(settings)
    app = create_app(settings, core=core)
    service = app.state.services._factory(model_name=MODEL)
    assert isinstance(service, RAGService)
    assert service.collections_root == settings.collections_root
    assert service.index_cache_root == settings.data_root / "cache" / "rag_v2"
    assert service.pipeline_identity()["pipeline_signature"] == core.identity["pipeline_signature"]
