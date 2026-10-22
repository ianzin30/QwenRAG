import { ApiError, toApiError } from './errors';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** Small typed wrapper over fetch: base URL, JSON, timeouts and error normalization. */
export class HttpClient {
  constructor(private readonly baseUrl: string) {}

  url(path: string): string {
    const base = this.baseUrl.replace(/\/+$/, '');
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async json<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.raw(path, options);
    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new ApiError('protocol', 'Resposta do servidor em formato inesperado.', { cause: error });
    }
  }

  async text(path: string, options: RequestOptions = {}): Promise<string> {
    return (await this.raw(path, options)).text();
  }

  /** Performs the request and throws ApiError for transport failures and non-2xx statuses. */
  async raw(path: string, { method = 'GET', body, signal, headers = {}, timeoutMs = 30_000 }: RequestOptions = {}): Promise<Response> {
    const timeout = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    const combined = signal && timeout ? AbortSignal.any([signal, timeout]) : signal ?? timeout;
    const init: RequestInit = { method, signal: combined, headers: { Accept: 'application/json', ...headers } };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    }
    let response: Response;
    try {
      response = await fetch(this.url(path), init);
    } catch (error) {
      if (timeout?.aborted && !signal?.aborted) throw new ApiError('timeout', 'O servidor demorou demais para responder.');
      throw toApiError(error);
    }
    if (!response.ok) throw await errorFromResponse(response);
    return response;
  }
}

/** FastAPI returns {"detail": "..."} or {"detail": [...]}; the proposal adds {"code", "message"}. */
async function errorFromResponse(response: Response): Promise<ApiError> {
  let message = `Erro ${response.status} no servidor.`;
  let code: string | undefined;
  try {
    const payload = (await response.json()) as { detail?: unknown; message?: unknown; code?: unknown };
    if (typeof payload.message === 'string') message = payload.message;
    else if (typeof payload.detail === 'string') message = payload.detail;
    if (typeof payload.code === 'string') code = payload.code;
  } catch {
    // Non-JSON error body: keep the generic message.
  }
  return new ApiError('http', message, { status: response.status, code });
}
