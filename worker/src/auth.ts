import type { Criteria, ProfileDocument } from './sources/types';

// PBKDF2 is the password hash Workers' Web Crypto supports. The iteration
// count is stored with each hash so it can be raised later without breaking
// existing accounts. 60k keeps a sign-in comfortably inside the CPU budget.
const ITERATIONS = 60_000;
const SESSION_DAYS = 30;
export const SESSION_COOKIE = 'ps_session';

const enc = new TextEncoder();
const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

/** Compares without bailing out at the first difference. */
export function sameText(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, iter, salt, hash] = stored.split('$');
  if (kind !== 'pbkdf2' || !iter || !salt || !hash) return false;
  return sameText(b64(await pbkdf2(password, unb64(salt), Number(iter))), hash);
}

async function sha256(s: string): Promise<string> {
  return b64(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

export interface User {
  id: number;
  username: string;
  pass_hash: string | null;
  criteria_json: string | null;
  document_json: string | null;
}

/** Creates a session and returns the token for the cookie. Only its hash is stored. */
export async function createSession(db: D1Database, userId: number): Promise<{ token: string; maxAge: number }> {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, '');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await db
    .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, expires)
    .run();
  // Opportunistic cleanup of expired sessions.
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(new Date().toISOString()).run();
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export async function userForSession(db: D1Database, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  return db
    .prepare(
      `SELECT u.id, u.username, u.pass_hash, u.criteria_json, u.document_json
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .bind(await sha256(token), new Date().toISOString())
    .first<User>();
}

export async function deleteSession(db: D1Database, token: string | undefined): Promise<void> {
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
}

export async function findUser(db: D1Database, username: string): Promise<User | null> {
  return db
    .prepare('SELECT id, username, pass_hash, criteria_json, document_json FROM users WHERE username = ?')
    .bind(username.trim())
    .first<User>();
}

export async function createUser(db: D1Database, username: string, password: string): Promise<number> {
  const res = await db
    .prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)')
    .bind(username.trim(), await hashPassword(password), new Date().toISOString())
    .run();
  return Number(res.meta.last_row_id);
}

export async function setPassword(db: D1Database, userId: number, password: string): Promise<void> {
  await db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').bind(await hashPassword(password), userId).run();
}

export async function setUserCriteria(db: D1Database, userId: number, criteria: Criteria): Promise<void> {
  await db.prepare('UPDATE users SET criteria_json = ? WHERE id = ?').bind(JSON.stringify(criteria), userId).run();
}

export async function setUserDocument(db: D1Database, userId: number, doc: ProfileDocument): Promise<void> {
  await db.prepare('UPDATE users SET document_json = ? WHERE id = ?').bind(JSON.stringify(doc), userId).run();
}

export const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
export const MIN_PASSWORD = 8;
