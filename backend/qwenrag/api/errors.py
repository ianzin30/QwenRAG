"""Public JSON errors: {"detail": "...", "code": "..."}; never stack traces."""
from fastapi import Request
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, detail: str, code: str | None = None):
        super().__init__(detail)
        self.status = status
        self.detail = detail
        self.code = code


async def api_error_handler(_request: Request, exc: ApiError):
    body = {"detail": exc.detail}
    if exc.code:
        body["code"] = exc.code
    return JSONResponse(body, status_code=exc.status)


def from_persistence(result, *, not_found_code="conflict"):
    """Map persistence results onto HTTP errors."""
    if result.status == "conflict":
        return ApiError(409, result.error or "A conversa mudou. Atualize o histórico.", not_found_code)
    return ApiError(503, result.error or "Não foi possível salvar o histórico.", "storage_failed")
