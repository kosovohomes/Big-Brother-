// Lightweight session auth (HMAC-signed httpOnly cookie).
// scrypt password hashing; no external deps. Roles: OWNER | ADMIN |
// CASEWORKER | LAWYER | MEMBER (PRD 5.11 AC1 role-based access).
//
// Phase A (C-A7): sessions carry an issued-at (`iat`) and are checked against
// `users.sessions_invalid_before` — logout / account deletion revokes every
// cookie issued earlier, so a replayed stateless cookie dies immediately
// (e2e T-21). COOKIE_SECURE becomes env-driven; SESSION_SECRET is mandatory
// when STORAGE_BACKEND=pg (boot guard in storage/index.ts).

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { SessionPayload } from './types';
import { getUserSecurity } from './db';

const SECRET = process.env.SESSION_SECRET || 'big-brother-dev-secret-v2.1';
export const SESSION_COOKIE = 'bb_session';
const TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

const b64url = (s: string) => Buffer.from(s).toString('base64url');
const unb64url = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

function sign(data: string): string {
  return createHmac('sha256', SECRET).update(data).digest('base64url');
}

export function createSessionToken(p: Omit<SessionPayload, 'exp'>): string {
  const payload: SessionPayload = { ...p, iat: Date.now(), exp: Date.now() + TTL_MS };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** HMAC + expiry verification (synchronous crypto part). */
export function verifySessionToken(token?: string | null): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(unb64url(body)) as SessionPayload;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Full session resolution: signature/expiry + revocation window (C-A7).
 * A cookie without `iat` (pre-Phase-A) is treated as issued before ANY
 * revocation epoch — once `sessions_invalid_before` is set it stops working.
 */
export async function getSession(req: NextRequest): Promise<SessionPayload | null> {
  const payload = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  const sec = await getUserSecurity(payload.uid);
  if (!sec) return null; // user row gone (deleted)
  if (sec.deleteScheduledAt) return null; // scheduled for deletion (PRD 5.10)
  const invalidBefore = sec.sessionsInvalidBefore ? Date.parse(sec.sessionsInvalidBefore) : 0;
  const iat = payload.iat ?? 0;
  if (invalidBefore > 0 && iat < invalidBefore) return null;
  return payload;
}

export function sessionCookieOptions() {
  // Task 17: Secure must be ON for production (https) deployments by default —
  // the previous env-gated default (COOKIE_SECURE === 'true') shipped the
  // session cookie WITHOUT Secure on Vercel. Explicit override wins; local
  // http dev/e2e stays false via NODE_ENV !== 'production' or COOKIE_SECURE=false.
  const secure = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: TTL_MS / 1000
  };
}
