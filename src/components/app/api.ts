// Client-side API helper with session-aware error handling.
export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body?.error || `HTTP ${status}`));
    this.status = status;
    this.body = body || {};
  }
}

async function handle(res: Response) {
  let body: Record<string, unknown> = {};
  try { body = await res.json(); } catch { /* non-json */ }
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}

export const api = {
  get: (url: string) => fetch(url, { cache: 'no-store' }).then(handle),
  post: (url: string, data?: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {})
    }).then(handle),
  put: (url: string, data?: unknown) =>
    fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) }).then(handle),
  del: (url: string) => fetch(url, { method: 'DELETE' }).then(handle),
  rawPost: (url: string, body: ArrayBuffer | Blob, headers: Record<string, string>) =>
    fetch(url, { method: 'POST', body, headers }).then(handle)
};
