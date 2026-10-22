"""Server-sent events: one replayable log per job, decoupled from any HTTP connection."""
from __future__ import annotations

import asyncio
import json

from fastapi.responses import StreamingResponse

SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def format_event(event: str, data: dict) -> str:
    # json.dumps never emits raw newlines, so one data: line is always enough.
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


KEEP_ALIVE = ": ping\n\n"


class EventLog:
    """Events published from worker threads; every subscriber replays from the start.

    The job keeps running when a client disconnects, and a second request for the
    same job (an idempotent retry) sees the same events instead of a new execution.
    """

    def __init__(self, loop: asyncio.AbstractEventLoop | None = None):
        self.loop = loop or asyncio.get_running_loop()
        self.events: list[tuple[str, dict]] = []
        self.closed = False
        self._changed = asyncio.Event()

    def publish(self, event: str, data: dict, *, final: bool = False) -> None:
        """Thread-safe. A final event closes the log."""
        self.loop.call_soon_threadsafe(self._append, event, data, final)

    def _append(self, event, data, final):
        if self.closed:
            return
        self.events.append((event, data))
        self.closed = final
        changed, self._changed = self._changed, asyncio.Event()
        changed.set()

    async def follow(self, keep_alive_seconds: float):
        index = 0
        while True:
            while index < len(self.events):
                event, data = self.events[index]
                index += 1
                yield format_event(event, data)
            if self.closed:
                return
            changed = self._changed
            try:
                await asyncio.wait_for(changed.wait(), keep_alive_seconds)
            except asyncio.TimeoutError:
                yield KEEP_ALIVE


def sse_response(chunks) -> StreamingResponse:
    return StreamingResponse(chunks, media_type="text/event-stream", headers=SSE_HEADERS)


def remember(registry: dict, key, value, limit: int = 64) -> None:
    """Bounded insertion-ordered registry of finished and running jobs."""
    registry[key] = value
    while len(registry) > limit:
        oldest = next(iter(registry))
        job = registry[oldest]
        if not getattr(getattr(job, "log", job), "closed", True):
            break  # never forget a running job
        registry.pop(oldest)
