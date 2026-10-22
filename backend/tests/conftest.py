"""Shared fixtures: temporary data root, a lock for the installed core, no network."""
import json
from pathlib import Path

import pytest

from qwenrag.core_lock import build_lock, installed_commit
from qwenrag.settings import AppSettings

MODEL = "nvidia/Qwen3.6-35B-A3B-NVFP4"
CONFIG = Path(__file__).resolve().parents[2] / "config" / "qwenrag.toml"


def make_settings(tmp_path, **core):
    import tomllib

    raw = tomllib.loads(CONFIG.read_text(encoding="utf-8"))
    raw.update(data_root=str(tmp_path / "data"), env_file=str(tmp_path / ".env"))
    raw["core"] = {**raw["core"], "lock": str(tmp_path / "core-release.lock.json"), **core}
    lock = tmp_path / "core-release.lock.json"
    if not lock.exists():
        # The commit check only applies to git installs (PEP 610); local builds have none.
        lock.write_text(json.dumps(build_lock(installed_commit() or "0" * 40)), encoding="utf-8")
    return AppSettings.from_mapping(raw, base=CONFIG.parent)


@pytest.fixture
def no_network(monkeypatch):
    monkeypatch.setattr("socket.socket.connect", lambda *a, **kw: pytest.fail("Network forbidden in backend tests"))


@pytest.fixture
def settings(tmp_path, no_network):
    return make_settings(tmp_path)
