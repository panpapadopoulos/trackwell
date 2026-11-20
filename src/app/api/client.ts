/**
 * Browser API client. Every non-2xx response THROWS an ApiError. A failed
 * request can never be mistaken for "no data" (legacy defect D1). Responses are
 * never logged, so financial data never reaches the browser console.
 */
import type { ApiErrorBody } from '@/shared/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody,
  ) {
    super(body.message ?? body.error);
  }
  get fields(): Record<string, string> {
    return this.body.fields ?? {};
  }
}

let csrfToken = '';
export const setCsrf = (t: string) => {
  csrfToken = t;
};

async function request<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError')
      throw new ApiError(0, {
        error: 'timeout',
        message: 'This is taking longer than expected. Nothing was saved; you can try again.',
      });
    throw new ApiError(0, {
      error: 'network',
      message: 'Can’t reach Trackwell. Check your connection; nothing was saved.',
    });
  }
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const b = (parsed ?? {}) as ApiErrorBody;
    const retry = res.headers.get('Retry-After');
    throw new ApiError(res.status, {
      error: b.error ?? 'http_error',
      message:
        b.message ??
        (res.status === 401
          ? 'Your session ended. Sign in again.'
          : res.status === 429
            ? `Too many attempts. Try again in ${Math.ceil(Number(retry ?? 900) / 60)} minutes.`
            : 'Something went wrong. Nothing was saved.'),
      ...(b.fields ? { fields: b.fields } : {}),
    });
  }
  return parsed as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown, opts?: { timeoutMs?: number }) =>
    request<T>('POST', p, b ?? {}, opts?.timeoutMs),
  put: <T>(p: string, b: unknown) => request<T>('PUT', p, b),
  del: <T>(p: string, b?: unknown) => request<T>('DELETE', p, b),
};

export type Saved = { id: string; updatedAt: number };
