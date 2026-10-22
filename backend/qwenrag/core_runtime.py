"""The one place where QwenRAG meets rag-ufc-core.

The pipeline comes from the installed core release; this module adds deployment
settings, verifies that the installed package is the release pinned in
core-release.lock.json, and keeps the effective pipeline identity for diagnostics
and for every stored answer.
"""

from __future__ import annotations

import hashlib
import importlib.resources
import json
import os
from pathlib import Path

from dotenv import dotenv_values
from rag_ufc_core import DataPaths, EngineSettings, RAGService, check_adoption, pipeline_identity, release_manifest
from rag_ufc_core.secret_source import use_secret_source

from .settings import AppSettings


class CoreAdoptionError(RuntimeError):
    pass


def installed_manifest_sha256() -> str:
    data = importlib.resources.files("rag_ufc_core").joinpath("RELEASE.json").read_bytes()
    return hashlib.sha256(data).hexdigest()


def read_lock(path: Path) -> dict:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise CoreAdoptionError(f"Core release lock unreadable: {path}") from exc


def lock_problems(lock: dict) -> list[dict]:
    """Installed package versus the release this application adopted."""
    manifest = release_manifest()
    problems = []
    checks = (
        ("core_version", manifest["core_version"]),
        ("release_manifest_sha256", installed_manifest_sha256()),
        ("pipeline_config_hash", manifest["pipeline"]["pipeline_config_hash"]),
        ("approval_status", manifest["approval"]["status"]),
    )
    for key, actual in checks:
        if lock.get(key) != actual:
            problems.append({"kind": "pin", "detail": f"{key} differs from core-release.lock.json",
                             "expected": lock.get(key), "actual": actual})
    from .core_lock import installed_commit
    commit = installed_commit()
    expected = (lock.get("source") or {}).get("commit")
    if commit and commit != expected:
        problems.append({"kind": "pin", "detail": "installed core commit differs from core-release.lock.json",
                         "expected": expected, "actual": commit})
    return problems


class CoreRuntime:
    def __init__(self, settings: AppSettings, *, enforce: bool = True):
        self.app_settings = settings
        env_file = settings.env_file

        def secret(name):
            # Process environment first; .env never overrides an exported variable.
            if name in os.environ:
                return os.environ[name]
            return dotenv_values(env_file, interpolate=False).get(name) if env_file.exists() else None

        use_secret_source(secret)
        core = settings.core
        self.engine_settings = EngineSettings.from_release(core.deployment, overrides=core.overrides)
        self.paths = DataPaths.under(settings.data_root)
        self.lock = read_lock(settings.lock_path)
        self.approved_model = self.engine_settings.llm.model
        self.model_labels = {option.model_name: option.label or option.model_name for option in settings.models}
        self.model_labels.setdefault(self.approved_model, self.approved_model)
        self.identity = pipeline_identity(self.engine_settings)
        self.adoption = self._adoption(self.identity)
        unapproved_models = [m for m in self.model_labels if m != self.approved_model]
        if enforce and not core.allow_divergent_pipeline:
            if self.adoption["status"] != "approved_match":
                raise CoreAdoptionError(self._refusal())
            if unapproved_models:
                raise CoreAdoptionError("Configured models outside the approved pipeline: " + ", ".join(unapproved_models))

    def _adoption(self, identity: dict) -> dict:
        report = check_adoption(identity, {"core_version": self.lock.get("core_version"),
                                           "core_source_fingerprint": self.lock.get("core_source_fingerprint")})
        extra = lock_problems(self.lock)
        if extra:
            report = {**report, "status": "pin_mismatch", "problems": report["problems"] + extra}
        return report

    def _refusal(self) -> str:
        details = [p["detail"] for p in self.adoption["problems"]]
        details += [f"{d['path']}: {d['expected']!r} -> {d['actual']!r}" for d in self.adoption["divergences"]]
        return ("The effective RAG pipeline is not the approved core release "
                f"({self.adoption['status']}): " + "; ".join(details)
                + ". Fix the pin/configuration or set core.allow_divergent_pipeline = true deliberately.")

    @property
    def default_model(self) -> str:
        return self.approved_model

    def model_options(self) -> list[dict]:
        return [{"model_name": name, "label": label, "is_default": name == self.approved_model}
                for name, label in self.model_labels.items()]

    def create_service(self, model_name: str) -> RAGService:
        return RAGService(self.engine_settings, self.paths, model_name=model_name)

    def identity_for(self, model: str, index_diagnostics=None) -> dict:
        return pipeline_identity(self.engine_settings.with_model(model), index_diagnostics=index_diagnostics)

    def turn_profile(self, model: str) -> dict:
        """Stored with every turn: which approved pipeline produced the answer."""
        identity = self.identity_for(model)
        adoption = self._adoption(identity)
        return {
            "llm": {"model": model},
            "pipeline": {
                "core_version": identity["core_version"],
                "core_source_fingerprint": identity["core_source_fingerprint"],
                "pipeline_signature": identity["pipeline_signature"],
                "pipeline_config_hash": identity["pipeline_config_hash"],
                "adoption_status": adoption["status"],
            },
        }

    def diagnostics(self, prepared_indexes: list[dict] | None = None) -> dict:
        """Safe for the browser: no endpoints, credential names or paths."""
        identity = self.identity
        return {
            "core": {"version": identity["core_version"], "source_fingerprint": identity["core_source_fingerprint"],
                     "pinned_commit": (self.lock.get("source") or {}).get("commit")},
            "release": self.adoption["release"],
            "adoption": {"status": self.adoption["status"], "problems": self.adoption["problems"],
                         "divergences": self.adoption["divergences"],
                         "environment_differences": self.adoption.get("environment_differences", [])},
            "pipeline": {"pipeline_id": identity["pipeline_id"], "pipeline_signature": identity["pipeline_signature"],
                         "pipeline_config_hash": identity["pipeline_config_hash"],
                         "index_format": identity["index_format"], "models": identity["models"]},
            "indexes": prepared_indexes or [],
        }
