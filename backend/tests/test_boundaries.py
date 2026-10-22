"""The application uses only the core's stable API and nothing from the research repository."""
import ast
from pathlib import Path
import re

PACKAGE = Path(__file__).resolve().parents[1] / "qwenrag"
STABLE_CORE_MODULES = {
    "rag_ufc_core", "rag_ufc_core.collections", "rag_ufc_core.errors", "rag_ufc_core.results",
    "rag_ufc_core.secret_source", "rag_ufc_core.identity", "rag_ufc_core.LocalUploads",
}
RESEARCH_OR_UI = {"benchmark", "service", "presentation", "application", "streamlit", "llm_client"}


def imports():
    for path in sorted(PACKAGE.rglob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Import):
                yield from ((path, alias.name) for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0:
                yield path, node.module


def test_application_imports_only_the_stable_core_api():
    used = {(path.name, name) for path, name in imports() if name.split(".")[0] == "rag_ufc_core"}
    assert {name for _, name in used} <= STABLE_CORE_MODULES, used


def test_application_has_no_research_imports_or_checkout_paths():
    assert not [(p.name, n) for p, n in imports() if n.split(".")[0] in RESEARCH_OR_UI]
    for path in PACKAGE.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        assert "sys.path.insert" not in text and "sys.path[" not in text, path
        assert not re.search(r"RAG[_-]UFC[^/\s]*/(application|benchmark|packages|data|config)", text), path
