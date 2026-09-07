// =====================================================================
// Convex auth gate (Task 13 hardening) — privileged writes require a
// server-held shared token (LAWYER_API_TOKEN) set on the deployment via
// `npx convex env set LAWYER_API_TOKEN ...`.
//
// Threat model: the deployment URL is public and every public query stays
// readable (the LKB is meant to be browsable). What must NOT be anonymous
// is mutation traffic: ingest (upsert), and the Phase 0 lawyer workflow
// (verify / deactivate / reactivate / amend). Before this gate anyone with
// the deployment URL could verify rows, i.e. forge lawyer sign-off.
//
// Design:
//   - FAIL-CLOSED: if the env var is missing on the deployment, every
//     privileged mutation refuses. A missing secret must never silently
//     downgrade to "open".
//   - The token never reaches the browser: callers are (a) the Next.js
//     server routes via src/lib/convex.ts (process.env.LAWYER_API_TOKEN,
//     server-only env), and (b) operator scripts that load .env.local.
//   - Comparison is a plain string equality against a 32-byte random hex
//     token; timing side-channels are impractical over the network for
//     this threat model (the token is never derived from user input).
//
// What this is NOT: end-user authn/authz. User identity stays in the
// Next.js session layer (roles LAWYER/ADMIN checked in /api routes, see
// src/app/api/kb/audit/[id]/route.ts). This gate protects the Convex
// deployment itself — the second door an attacker would try.
// =====================================================================

export const PRIVILEGED_TOKEN_ENV = "LAWYER_API_TOKEN";

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Throw unless `token` matches the deployment's LAWYER_API_TOKEN.
 * Called at the top of every privileged mutation handler.
 */
export function requirePrivilegedToken(token: string | undefined | null): void {
  const expected = process.env[PRIVILEGED_TOKEN_ENV];
  if (!expected) {
    throw new UnauthorizedError(
      `SERVER_MISCONFIGURED: ${PRIVILEGED_TOKEN_ENV} is not set on this deployment — all privileged writes are refused (fail-closed). Set it with: npx convex env set ${PRIVILEGED_TOKEN_ENV} <token>`
    );
  }
  if (!token || token !== expected) {
    throw new UnauthorizedError(
      "UNAUTHORIZED: missing or invalid token for a privileged LKB mutation"
    );
  }
}

/** Audit-log helper: append a self-describing trail row to auditLogs. */
export function auditDetail(action: string, detail: string): {
  at: number; action: string; detail: string;
} {
  return { at: Date.now(), action, detail };
}
