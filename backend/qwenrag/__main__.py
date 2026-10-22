"""python -m qwenrag [--host H] [--port P] [--check]

--check verifies the installed core release and prints the pipeline identity without
starting the server (use it after upgrading the core).
"""
import argparse
import json
import logging
import os
import sys


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m qwenrag", description=__doc__)
    parser.add_argument("--host", default=os.getenv("QWENRAG_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("QWENRAG_PORT", "8010")))
    parser.add_argument("--config", help="defaults to $QWENRAG_CONFIG, ./config/qwenrag.toml or ../config/qwenrag.toml")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)

    # Models and tokenizers come from local caches; no download at request time.
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    logging.basicConfig(level=logging.INFO)

    from .core_runtime import CoreAdoptionError, CoreRuntime
    from .settings import AppSettings

    try:
        settings = AppSettings.load(args.config)
        core = CoreRuntime(settings)
    except (CoreAdoptionError, FileNotFoundError) as exc:
        print(f"Refusing to start: {exc}", file=sys.stderr)
        return 2
    if args.check:
        print(json.dumps(core.diagnostics(), ensure_ascii=False, indent=2))
        return 0

    import uvicorn

    from .server import create_app
    # One worker: running turns, upload jobs and prepared RAG services live in this process.
    uvicorn.run(create_app(settings, core=core), host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
