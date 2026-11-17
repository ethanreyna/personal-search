import type { TailoredDocument } from './types';
import type { LetterContent } from './pdf';

/** Sends JSON and returns the parsed body, throwing the server's error message on failure. */
export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

/** Calls `onExpired` whenever an API request comes back 401 (session ended elsewhere). */
export function watchSession(onExpired: () => void): () => void {
  const original = window.fetch;
  window.fetch = async (input, init) => {
    const res = await original(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (res.status === 401 && url.includes('/api/') && !url.includes('/api/auth/')) onExpired();
    return res;
  };
  return () => {
    window.fetch = original;
  };
}

// Tailored document and letter, for anything under `base` (a listing or a personalization).
export const getDocument = (base: string, redo = false) =>
  api<TailoredDocument>(`${base}/document${redo ? '?redo=1' : ''}`, { method: 'POST' });
export const getLetter = (base: string, redo = false) =>
  api<LetterContent>(`${base}/letter${redo ? '?redo=1' : ''}`, { method: 'POST' });
export const saveLetter = (base: string, body: string) => api(`${base}/letter`, { method: 'PUT', body: { body } });
