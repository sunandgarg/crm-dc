const API_URL = String(import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/api\/?$/, '').replace(/\/+$/, '');
const SESSION_KEY = 'crm-dc-auth-session';

function accessToken() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null')?.access_token || null; }
  catch { return null; }
}

export class CRMApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) { super(message); }
}

export async function crmApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  const token = accessToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${API_URL}/api/crm${path}`, { ...init, headers, credentials: 'include' });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new CRMApiError(payload.error || `Request failed (${response.status})`, response.status, payload.details);
  return payload as T;
}

export function jsonRequest(method: string, body?: unknown): RequestInit {
  return { method, body: body === undefined ? undefined : JSON.stringify(body) };
}
