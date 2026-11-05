"""Loopback-only BGE-M3 lexical weights and tokenizer for QwenRAG."""
import argparse
from http.server import BaseHTTPRequestHandler, HTTPServer
import json

from FlagEmbedding import BGEM3FlagModel
import torch

MODEL = "BAAI/bge-m3"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint")
    parser.add_argument("--port", type=int, default=8007)
    args = parser.parse_args()
    torch.set_num_threads(4)
    bge = BGEM3FlagModel(args.checkpoint, devices="cpu", use_fp16=False)
    tokenizer = bge.tokenizer
    revision = args.checkpoint.rstrip("/").rsplit("/", 1)[-1]

    class Handler(BaseHTTPRequestHandler):
        timeout = 20

        def reply(self, status, payload):
            data = json.dumps(payload, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                self.reply(200, {"status": "ok", "model": MODEL, "revision": revision})
            else:
                self.reply(404, {"error": "unknown route"})

        def do_POST(self):
            if self.path not in ("/tokenize", "/v1/lexical"):
                self.reply(404, {"error": "unknown route"})
                return
            try:
                size = int(self.headers.get("Content-Length", 0))
                if not 0 < size <= 4_000_000:
                    self.reply(413, {"error": "invalid body size"})
                    return
                body = json.loads(self.rfile.read(size))
                if self.path == "/tokenize":
                    text = body["text"]
                    offsets = body.get("return_offsets_mapping", False)
                    if not isinstance(text, str) or type(offsets) is not bool:
                        raise ValueError()
                else:
                    texts, limit = body["input"], body["max_length"]
                    if (not isinstance(texts, list) or not 1 <= len(texts) <= 32
                            or not all(isinstance(t, str) for t in texts)
                            or type(limit) is not int or not 1 <= limit <= 8192):
                        raise ValueError()
            except (TypeError, ValueError, KeyError):
                self.reply(400, {"error": "invalid request"})
                return
            if self.path == "/tokenize":
                result = dict(tokenizer(text, add_special_tokens=False, return_offsets_mapping=offsets,
                                        return_attention_mask=False))
            else:
                weights = bge.encode(texts, batch_size=8, max_length=limit, return_dense=False,
                                     return_sparse=True, return_colbert_vecs=False)["lexical_weights"]
                result = {"weights": [{str(k): float(v) for k, v in row.items()} for row in weights]}
            self.reply(200, {"model": MODEL, "revision": revision, **result})

    HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
