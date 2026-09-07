// API route helpers: JSON responses, session guards, tenant scoping.
//
// Phase A (A1.1/A2.1): requireOrg is async and, on Postgres, opens the
// request-scoped tenant transaction (session GUCs app.org_id / app.user_id /
// app.role via AsyncLocalStorage) so RLS scopes every statement of the
// handler. This remains the SINGLE org-resolution path (C-A4): the GUC value
// is only ever the server-derived session.orgId after the membership check —
// never a header or body field.

import { NextRequest, NextResponse, after } from 'next/server';
import { getSession, SESSION_COOKIE, createSessionToken, sessionCookieOptions } from './auth';
import { getMembershipRole, getOrgById } from './db';
import { requestScope, endScope, bindTenantScope, withUserCtx, assertBootConfig } from './storage';
import type { SessionPayload } from './types';

// Fail fast on unsafe boot configurations (C-A7: pg mode needs SESSION_SECRET).
const bootProblems = assertBootConfig();
if (bootProblems.length) {
  console.error('[boot] Phase A config problems:', bootProblems.join('; '));
}

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status });

export const unauthorized = () => json({ error: 'unauthorized' }, 401);
export const forbidden = () => json({ error: 'forbidden' }, 403);
export const notFound = (what = 'resource') => json({ error: `${what} not found` }, 404);

// Require a valid session; returns the payload or null (caller returns 401).
export async function requireSession(req: NextRequest): Promise<SessionPayload | null> {
  return getSession(req);
}

/**
 * Route wrapper: establishes a shared request scope whose store requireOrg
 * binds the RLS tenant client into (pg). On sqlite it is a pass-through and
 * behavior is byte-identical to pre-Phase-A. Usage:
 *   export const GET = withOrg(async (req, ctx) => { const guard = await requireOrg(req); ... });
 */
export function withOrg<Params>(
  handler: (req: NextRequest, routeCtx: { params: Promise<Params> }) => Promise<Response>
) {
  return async (req: NextRequest, routeCtx: { params: Promise<Params> }): Promise<Response> => {
    const store = { kind: 'pending' } as Parameters<typeof bindTenantScope>[0];
    return requestScope.run(store, async () => {
      try {
        return await handler(req, routeCtx);
      } finally {
        if (store.client) await endScope(store);
      }
    });
  };
}

// Require session + that session.orgId is accessible. Returns context or an
// error Response the caller should return immediately. Inside withOrg (pg)
// this ALSO binds the RLS-scoped tenant client for the rest of the request —
// the single org-resolution path (C-A4): the GUC value is only ever the
// server-derived session.orgId after the membership check.
export async function requireOrg(
  req: NextRequest
): Promise<{ ctx: SessionPayload; role: string } | { error: NextResponse }> {
  const session = await getSession(req);
  if (!session) return { error: unauthorized() };
  // Authz lookups run user-scoped (RLS-visible via app.user_id on pg); the
  // tenant scope below is bound only AFTER they pass — no second path.
  const org = await withUserCtx(session.uid, () => getOrgById(session.orgId));
  if (!org) return { error: notFound('organization') };
  const role = await getMembershipRole(session.uid, session.orgId);
  if (!role) return { error: forbidden() };

  const store = requestScope.getStore();
  if (store && store.kind === 'pending') {
    const bound = await bindTenantScope(store, session.orgId, session.uid, role);
    after(async () => { await endScope(bound); });
  }

  return { ctx: session, role };
}

export function setSessionCookie(res: NextResponse, payload: Omit<SessionPayload, 'exp'>) {
  res.cookies.set(SESSION_COOKIE, createSessionToken(payload), sessionCookieOptions());
}

export async function readJson<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

const CASEWORKER_ROLES = ['OWNER', 'ADMIN', 'CASEWORKER'];
export const canManageCases = (role: string) => CASEWORKER_ROLES.includes(role) || role === 'MEMBER';
export const canReview = (role: string) => ['OWNER', 'ADMIN', 'LAWYER'].includes(role);

// 402 Payment Required — plan capacity limit reached (Stage 5 billing).
// Body is machine-readable so clients can offer an upgrade path.
export const planLimitReached = (limit: string, plan: string, max: number) =>
  json({ error: 'plan_limit', limit, plan, max, upgradeTo: 'PRO', message: `Plan ${plan} allows up to ${max} (${limit}). Upgrade to PRO to continue.` }, 402);
