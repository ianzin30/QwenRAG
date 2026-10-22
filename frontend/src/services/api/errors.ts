export type ApiErrorKind = 'network' | 'http' | 'timeout' | 'aborted' | 'protocol' | 'unsupported';

/** Every failure that crosses the service boundary is normalized into this shape. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;

  constructor(kind: ApiErrorKind, message: string, options: { status?: number; code?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'ApiError';
    this.kind = kind;
    this.status = options.status;
    this.code = options.code;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof ApiError && error.kind === 'aborted') ||
    (error instanceof DOMException && error.name === 'AbortError')
  );
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') return new ApiError('aborted', 'Operação cancelada.');
  if (error instanceof TypeError) {
    return new ApiError('network', 'Não foi possível falar com o servidor. Confira a conexão.', { cause: error });
  }
  return new ApiError('protocol', error instanceof Error ? error.message : 'Erro inesperado.', { cause: error });
}

/** Short user-facing text for an error. */
export function describeError(error: unknown): string {
  const e = toApiError(error);
  if (e.kind === 'http' && e.status === 404) return 'Recurso não encontrado no servidor.';
  if (e.kind === 'http' && e.status && e.status >= 500) return e.message || 'O servidor encontrou um erro.';
  return e.message;
}
