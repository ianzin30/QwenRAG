"""Application settings: config/qwenrag.toml plus environment.

The RAG pipeline itself is not configured here. It comes from the pinned core
release (``EngineSettings.from_release``); this file only adds deployment details
(endpoints, credential variable names, timeouts, device, data locations) and,
exceptionally, explicit pipeline overrides that the adoption check reports.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import os
from pathlib import Path
import tomllib

from pydantic import BaseModel, ConfigDict, Field

# Repository root or backend/ as working directory.
DEFAULT_CONFIGS = (Path("config/qwenrag.toml"), Path("../config/qwenrag.toml"))


class ChatSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    history_messages: int = Field(default=6, ge=0, le=100)
    max_sessions: int = Field(default=6, ge=1)
    title_max_chars: int = Field(default=34, ge=8)
    excerpt_chars: int = Field(default=900, ge=1)
    default_title: str = "Nova conversa"


class ModelOption(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_name: str
    label: str = ""


class CoreSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lock: str = "../core-release.lock.json"
    # Refuse to start when the effective pipeline is not the approved one.
    allow_divergent_pipeline: bool = False
    deployment: dict = Field(default_factory=dict)
    overrides: dict = Field(default_factory=dict)


class FileSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    data_root: str = "../data"
    conversations_file: str = "conversations.json"
    env_file: str = "../.env"
    max_upload_mb: int = Field(default=200, ge=1)
    chat: ChatSettings = Field(default_factory=ChatSettings)
    models: list[ModelOption] = Field(default_factory=list)
    core: CoreSettings = Field(default_factory=CoreSettings)


@dataclass(frozen=True)
class AppSettings:
    config_path: Path
    data_root: Path
    conversations_path: Path
    env_file: Path
    lock_path: Path
    max_upload_bytes: int
    chat: ChatSettings
    models: tuple[ModelOption, ...]
    core: CoreSettings = field(default_factory=CoreSettings)

    @property
    def collections_root(self) -> Path:
        return self.data_root / "collections"

    @classmethod
    def load(cls, path=None) -> "AppSettings":
        """``path``, ``QWENRAG_CONFIG`` or config/qwenrag.toml found from the working directory.

        Relative paths inside the file are relative to the file. A missing file is an error:
        silently running with defaults would put data and secrets in unexpected places.
        """
        explicit = path or os.environ.get("QWENRAG_CONFIG")
        candidates = [Path(explicit)] if explicit else list(DEFAULT_CONFIGS)
        found = next((c.resolve() for c in candidates if c.exists()), None)
        if found is None:
            raise FileNotFoundError("QwenRAG configuration not found: " + ", ".join(str(c) for c in candidates))
        raw = tomllib.loads(found.read_text(encoding="utf-8"))
        return cls.from_mapping(raw, base=found.parent, config_path=found)

    @classmethod
    def from_mapping(cls, raw: dict, *, base: Path, config_path: Path | None = None) -> "AppSettings":
        values = FileSettings.model_validate(raw)
        base = Path(base)

        def resolve(value):
            candidate = Path(os.path.expanduser(value))
            return candidate if candidate.is_absolute() else (base / candidate).resolve()

        data_root = resolve(os.environ.get("QWENRAG_DATA_ROOT") or values.data_root)
        return cls(
            config_path=Path(config_path or base / "qwenrag.toml"),
            data_root=data_root,
            conversations_path=resolve(os.environ.get("QWENRAG_CONVERSATIONS_FILE")
                                       or data_root / values.conversations_file),
            env_file=resolve(values.env_file),
            lock_path=resolve(values.core.lock),
            max_upload_bytes=values.max_upload_mb * 1024 * 1024,
            chat=values.chat,
            models=tuple(values.models),
            core=values.core,
        )
