"""Write core-release.lock.json from the installed rag-ufc-core (docs/core-upgrade.md).

    uv run python -m qwenrag.core_lock --commit <RAG_UFC commit pinned in pyproject.toml>

The lock is what the application adopted: version, source commit, source fingerprint,
the release manifest hash and the approved pipeline hash. Startup refuses to run
when the installed package no longer matches it.
"""
from __future__ import annotations

import argparse
from datetime import date
from importlib.metadata import distribution
import json
from pathlib import Path
import sys

from rag_ufc_core import __version__, release_manifest
from rag_ufc_core.identity import core_source_fingerprint

REPOSITORY = "https://github.com/ianzin30/RAG_UFC.git"
SUBDIRECTORY = "packages/rag-ufc-core"


def installed_commit() -> str | None:
    """The git commit the installed core was built from (PEP 610), if installed from git."""
    raw = distribution("rag-ufc-core").read_text("direct_url.json")
    if not raw:
        return None
    return (json.loads(raw).get("vcs_info") or {}).get("commit_id")


def build_lock(commit: str, repository: str = REPOSITORY) -> dict:
    from .core_runtime import installed_manifest_sha256

    manifest = release_manifest()
    return {
        "schema": "qwenrag.core_release_lock.v1",
        "core_version": __version__,
        "source": {"repository": repository, "commit": commit, "subdirectory": SUBDIRECTORY},
        "core_source_fingerprint": core_source_fingerprint(),
        "release_manifest_sha256": installed_manifest_sha256(),
        "release_kind": manifest.get("release_kind"),
        "approval_status": manifest["approval"]["status"],
        "pipeline_config_hash": manifest["pipeline"]["pipeline_config_hash"],
        "adopted_at": date.today().isoformat(),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m qwenrag.core_lock", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--repository", default=REPOSITORY)
    parser.add_argument("--out", default=str(Path(__file__).resolve().parents[2] / "core-release.lock.json"))
    args = parser.parse_args(argv)
    actual = installed_commit()
    if actual and actual != args.commit:
        print(f"Installed rag-ufc-core comes from {actual}, not {args.commit}. Run uv sync first.", file=sys.stderr)
        return 2
    lock = build_lock(args.commit, args.repository)
    Path(args.out).write_text(json.dumps(lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(lock, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
