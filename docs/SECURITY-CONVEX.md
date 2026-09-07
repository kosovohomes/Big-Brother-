# Convex Security — vivid-hare-882 (Task 13 hardening)

Status: hardened 2026-09-08. This doc is the operator runbook for the cloud
LKB deployment; the code-side gate lives in `convex/auth.ts`.

## Threat model

The Convex deployment URL (`https://vivid-hare-882.eu-west-1.convex.cloud`)
is public — every browser that loads the app can see it, and every public
`provisions:*` query is readable by design (the LKB is meant to be browsable).
What must never be anonymous is **mutation traffic**: before the gate, anyone
with the URL could call `provisions.verify` and forge lawyer sign-off on the
Phase 0 audit (PRD 3.3 / 6.3a) or inject rows via `upsert`.

## What is gated

| Function | Gate | Notes |
|---|---|---|
| `provisions.upsert` | token | ingest; verified:false is not settable at ingest |
| `provisions.verify` | token | the ONLY path that flips `verified:true` |
| `provisions.deactivate` | token | retire a row (cannot be cited) |
| `provisions.reactivate` | token | undo deactivation |
| `provisions.amend` | token | v+1 publish + retire old (transactional) |
| `provisions.authPing` | token | zero-side-effect gate health probe |
| all `provisions:*` queries | none | public reads by design |

Every gated mutation also appends an `auditLogs` row on the deployment
(`lkb.convex.ingest|verify|deactivate|reactivate|amend`).

## How the gate works

- A 32-byte random token is stored **on the deployment**:
  `CONVEX_DEPLOYMENT=dev:vivid-hare-882 npx convex env set LAWYER_API_TOKEN <token>`
  and mirrored **server-only** in `.env.local` (gitignored, never
  `NEXT_PUBLIC_*`, never shipped to the browser).
- Callers: (a) Next.js server routes via `src/lib/convex.ts`
  (`privilegedToken()` reads `process.env.LAWYER_API_TOKEN`); (b) operator
  scripts (`scripts/seed-convex-laws.mjs`, `scripts/create-auth-test-row.mjs`)
  which parse `.env.local` directly.
- **Fail-closed**: if the env var is unset on the deployment, every privileged
  mutation refuses (`SERVER_MISCONFIGURED`) — a missing secret can never
  silently downgrade to open. The Next.js side fails the same way.
- User identity/roles stay in the Next.js session layer
  (`/api/kb/audit/[id]` enforces `role === 'LAWYER'`); the Convex token is the
  second door — protecting the deployment itself from direct calls.

## Verify the gate (negative + positive)

```bash
node scripts/verify-convex-auth.mjs
# expect: no-token refused, wrong-token refused, authPing ok, public stats ok
```

## Rotate the token

```bash
NEW=$(openssl rand -hex 32)
CONVEX_DEPLOYMENT=dev:vivid-hare-882 npx convex env set LAWYER_API_TOKEN "$NEW"
# update .env.local (LAWYER_API_TOKEN=...) and restart the Next server
```

Rotation is zero-downtime for reads (unchanged) and only invalidates in-flight
writes during the seconds between the two steps.

## Known residuals / accepted risks

- Shared-secret (not per-user) auth on the Convex layer: acceptable for the
  MVP because the token is server-side only and the user-facing role model is
  enforced at the API layer. If scripts ever move to the browser, replace with
  Convex Auth (Clerk/Auth0 identity) before shipping.
- String comparison of the token (not constant-time): impractical to exploit
  over the network for a 256-bit random value; revisit if tokens become
  short/human-memorable.
- The dev deployment (`dev:vivid-hare-882`) is the live LKB. Promote to a
  production deployment (`npx convex deploy`) before public launch and set the
  token there too.
- A stray empty deployment may exist on the almizanpro dashboard from the
  Task 11 misdirected first push — safe to delete.
- One-row lineage delta between Convex (2107) and the rebuilt hermetic sqlite
  LKB (2106): a legacy 16/1960 version-chain row from the pre-clean DB; the
  Phase 0 lawyer audit reconciles it.
