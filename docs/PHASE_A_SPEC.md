# Phase A Implementation Plan & Migration Spec — Big Brother v2.1

**Doc**: `docs/PHASE_A_SPEC.md` · v1.0 · 2026-09-07
**Scope**: Phase A only — Postgres migration, tenant hardening (RLS + envelope encryption), document-originals object storage. **No code in this doc is final implementation; this is the plan + migration spec.** RAG/LLM/counter-reply-v2 remain Phase B/C per `docs/Big-Brother-Technical-Architecture-Specification.pdf` (TAS).
**Method**: every proposal below cites the existing file (and line where useful) it extends or replaces. Where the brief and the code disagree, the conflict is **flagged**, never silently resolved. `src/lib/engine.ts` was read but is **out of scope by design** (pure function, no I/O — `engine.ts:1-11`); Phase A does not modify it.

---

## 0. Verified baseline (read from the repo, not assumed)

| # | Fact | Evidence |
|---|---|---|
| B1 | Storage is `node:sqlite` via `DatabaseSync`, WAL mode, zero native deps; DDL + row mappers in one module | `src/lib/sqlite.mjs:1-15, 18-155, 214-275` |
| B2 | Typed facade (`db.ts`) is the **only** data API used by all 38 route handlers; no route touches raw SQL except via facade re-exports | `src/lib/db.ts:1-299`; `README.md` architecture tree |
| B3 | Tenancy is enforced **in app code**: `requireOrg()` derives `orgId` from the HMAC-signed session and verifies membership, per request | `src/lib/api-helpers.ts:21-31`; `src/lib/auth.ts:20-45` |
| B4 | Documents are **hash-only**: SHA-256 + metadata sealed, `content not stored server-side`; version chain via `previousId`, mismatch flagged, HIGH `metaRisk` notifies the case owner | `src/app/api/cases/[id]/documents/route.ts:19-71`; `src/lib/notifications.ts:151-178` |
| B5 | Voice-note audio is also hash-only (`content not stored server-side`), gated by a consent check that returns **428** | `src/app/api/cases/[id]/voice-note/route.ts` (seal + consent gate) |
| B6 | Data deletion: `mode:"workspace"` purges cases+drafts immediately; `mode:"account"` sets `users.delete_scheduled_at` and login returns 403 once scheduled | `src/app/api/data/delete/route.ts:19-36`; `src/app/api/auth/login/route.ts` (403 branch) |
| B7 | Billing: plan limits enforced with machine-readable **402 `plan_limit`** at 4 choke points; Stripe webhook is signature-verified and idempotent via `billing_events.ref` | `src/lib/api-helpers.ts:52`; `src/lib/billing.ts:27-64,135-150`; `src/app/api/billing/webhook/route.ts:8-22,57` |
| B8 | Notifications are strictly per-user (`org_id`+`user_id`, unique `(user_id, dedupe_key)`) | `src/lib/notifications.ts:1-12,32-47`; `prisma/schema.prisma:57-77` |
| B9 | e2e suite = **exactly 98 `check()` call sites** (99 occurrences − 1 definition at `scripts/e2e.mjs:24`), 11 sections, self-healing, isolated-org pattern already used for billing tests | `scripts/e2e.mjs:24-414` |
| B10 | `prisma/schema.prisma` is a **documentation/parity artifact** (datasource = sqlite; runtime DDL lives in `sqlite.mjs`); models have **no `@@map`**, so generated Prisma DDL would not match the physical snake_case tables | `prisma/schema.prisma:5-8`; `README.md:51` |
| B11 | PRD anchors: 7-day deletion (§5.10 AC1), CITRA minimisation (§7), "ensure and maintain integrity" (Change 12) | `upload/Big_Brother_PRD_v2.1.md` |

## 0.1 Conflict register (flagged, not assumed)

| ID | Conflict / gap found in code | Phase A treatment |
|---|---|---|
| **C-A1** | The brief names `src/app/api/documents/route.ts` — **it does not exist**. Documents are handled only at `src/app/api/cases/[id]/documents/route.ts` (case-scoped; grep for `api/documents` in `src/` returns nothing). | A3 extends the existing case-scoped route; no new top-level documents route is introduced. |
| **C-A2** | The 7-day deletion workflow is **scheduled-only**: `delete_scheduled_at` is written and login is blocked, but **no completion job exists** — nothing actually deletes after 7 days. PRD §5.10 AC1 requires completion *within* 7 days. | Phase A adds the deletion reaper (A2.4) — this closes a live compliance gap rather than preserving it. |
| **C-A3** | `audit_logs.org_id` is **nullable** (`prisma/schema.prisma:312`; `sqlite.mjs:122-125`) and `audit()` detail strings carry PII-ish content (case numbers, org slugs, file names — e.g. `documents/route.ts:59`, `db.ts:267`). This conflicts with "hash-only audit survives crypto-shredding": if the audit row is the survivor record, its `detail` column is a residual-PII risk. | RLS policy treats `NULL` org rows as system-only (invisible to tenant GUCs, §A2.1-P12); audit detail **redaction policy** is introduced in A2.4 and its wording is a human-only decision (§5). |
| **C-A4** | `getCaseById(id)` has **no org filter** (`db.ts:59`); tenancy for case children is enforced ad-hoc by callers (`documents/route.ts:14,28` re-checks `org_id`). Under RLS this app-layer check becomes defense-in-depth — it must be **kept**, not removed, and the RLS policy becomes the second layer. | Both layers retained; cross-tenant T-suite proves each layer independently (§A2.5). |
| **C-A5** | `ORDER BY ... rowid DESC` in `db.ts:228` (billing ledger) and `notifications.ts:185` has **no Postgres equivalent** — migration silently changes ordering unless addressed. | `seq` identity column added to `billing_events` + `notifications` (Prisma diff §A1.4); facade query text updated behind the same function signature. |
| **C-A6** | `prisma/schema.prisma` lacks `@@map`/`@map` (B10) — it cannot be used *as-is* as the Postgres DDL source. | Phase A hand-maintains `scripts/pg/*.sql` mirroring `sqlite.mjs` DDL, and adds `@@map`/`@map` to `schema.prisma` for parity (A0). Recommendation for thin-`pg`-over-Prisma-runtime in §A1.1. |
| **C-A7** | `sessionCookieOptions()` ships `secure:false` (`auth.ts:51`) and `SESSION_SECRET` has a hardcoded dev fallback (`auth.ts:9`). Stateless HMAC cookies also **cannot be revoked** after logout — a replayed cookie stays valid until TTL (14 days). RLS confines the blast radius but does not fix it. | Phase A: mandatory `SESSION_SECRET` in pg mode; `secure` flag tied to env; session revocation via `users.sessions_invalid_before` epoch checked in `verifySessionToken` (`auth.ts:26`) — the smallest change that makes T-21 pass. |
| **C-A8** | The billing webhook has **no session** by design (`webhook/route.ts:17-22`) — a legitimate cross-tenant system actor. Under RLS/FORCE it cannot use the `bb_app` role's GUC path. | Webhook + reaper + seed run as `bb_system` (owner, GUC-per-operation) — see role model §A2.1; webhook-replay cross-org attack covered by T-20. |
| **C-A9** | `legal_provisions` is deliberately **global** (no `orgId` — shared 48-provision corpus, `sqlite.mjs:39-52`). Blindly applying `org_id = current_setting(...)` RLS would break the KB for every tenant. | Excluded from org RLS; authenticated-read policy + app-layer lawyer gate (`canVerify`, `api-helpers.ts:47`) unchanged (§A2.1-P13). |
| **C-A10** | `documents` POST reads the entire body into memory (`req.arrayBuffer()`, `documents/route.ts:31`; same in voice-note). Acceptable for hash-only; **not** acceptable for large originals into object storage. | A3 upload path moves to streaming/presigned; the legacy raw-body path stays for the no-object-storage fallback so the 98 checks pass unchanged. |
| **C-A11** | e2e count: the brief says "extend the existing 98 checks" — **verified correct** (B9). (The earlier 39-check claim from the v2.1 rebuild stage is historical; Stages 4–6 raised it to 98.) | No conflict; suite grows 98 → 132 (§A4.4). |

---

# A1. Database migration: SQLite → PostgreSQL

## A1.1 Recommendation: thin `pg` layer **behind the existing facade** (not Prisma runtime)

**Decision**: keep the exact function-signature facade (`src/lib/db.ts`) and swap the driver under it. Introduce a `StorageDriver` interface with two implementations:

```
src/lib/storage/
  driver.d.ts        # interface: prepare(sql).run/get/all, exec, tx(fn), dialect
  sqlite-driver.mjs  # wraps today's node:sqlite DatabaseSync  (sqlite.mjs, unchanged behavior)
  pg-driver.mjs      # pg Pool + ? → $n rewriter + rowid shim + tx/GUC helpers
  index.ts           # getDriver(): env STORAGE_BACKEND 'sqlite' (default) | 'pg'
```

**Why not Prisma-as-runtime** (with the existing `prisma/schema.prisma`):
1. All 38 handlers call facade functions (`db.ts`), not Prisma models — Prisma would touch every call site and put the 98-check compatibility baseline at risk for zero functional gain.
2. `schema.prisma` models don't map to the physical snake_case tables (C-A6); using it as runtime would force either a rename of every table/column or `@@map` on every model — churn with no benefit in Phase A.
3. `sqlite.mjs` is shared by standalone scripts (`scripts/seed.mjs`, reaper) — a driver interface keeps that property; Prisma needs an engine binary and generated client in every context.
4. Prisma stays what it already is (B10): the portable schema documentation — updated for parity each migration (A0), still usable later if the team wants `prisma db pull` audits.

**Why Postgres 16**: RLS (`CREATE POLICY` / `current_setting`) is the tenant-hardening primitive required by A2 — SQLite has no equivalent, which is precisely why tenancy is currently app-code-only (B3). Postgres also gives real connection pooling, `pg_advisory_lock` for the reaper, and the `pgvector` upgrade path already selected by the TAS for Phase B (no second migration later).

**The key trick — request-scoped GUC without touching 38 call sites**: `requireOrg()` (`api-helpers.ts:21-31`) is the **single** org-resolution path (C-A4 keeps it that way). Phase A extends it: after the membership check, it opens a Postgres transaction, runs `set_config('app.org_id', $orgId, true)` + `set_config('app.user_id', $uid, true)` + `set_config('app.role', $role, true)` (transaction-local, auto-cleared), and stores the tx-bound client in `AsyncLocalStorage`. Facade functions pick up the ALS client when present, else fall back to the SQLite singleton. Every route that already calls `requireOrg` gets RLS scoping with **zero signature changes**; routes that don't (health, login, register, webhook) use explicit system/anonymous paths (§A2.1).

> Sketch (plan, not final code):
> ```ts
> // api-helpers.ts — extended requireOrg (same name, same return shape)
> export async function requireOrg(req) {
>   const session = getSession(req);                    // auth.ts:43 — unchanged
>   if (!session) return { error: unauthorized() };
>   const org = getOrgById(session.orgId);              // db.ts:53 — unchanged
>   if (!org) return { error: notFound('organization') };
>   const role = getMembershipRole(session.uid, session.orgId); // db.ts:42 — unchanged
>   if (!role) return { error: forbidden() };
>   await withTenantTx(session.orgId, session.uid, role, async () => { /* nothing — GUC is set */ });
>   return { ctx: session, role };
> }
> ```
> `withTenantTx` (new, `src/lib/storage/index.ts`): `BEGIN; SELECT set_config('app.org_id',$1,true), set_config('app.user_id',$2,true), set_config('app.role',$3,true); …route logic…; COMMIT/ROLLBACK` — all via `AsyncLocalStorage.context`.

## A1.2 Dialect inventory (what actually breaks)

| SQLite (`sqlite.mjs`) | Postgres 16 | Treatment |
|---|---|---|
| `PRAGMA journal_mode/foreign_keys` (`sqlite.mjs:14-15`) | n/a | pg driver no-ops |
| `?` placeholders | `$1..$n` | rewriter in pg-driver (single place) |
| `ORDER BY rowid DESC` (C-A5) | no rowid | `seq BIGINT GENERATED ALWAYS AS IDENTITY` on `billing_events`, `notifications`; ORDER BY `seq` |
| `INTEGER` booleans + `!!r.x` mappers (`sqlite.mjs:220,235`) | keep `SMALLINT 0/1` in v1 | zero mapper churn; `BOOLEAN` conversion deferred (documented) |
| ISO-8601 `TEXT` dates everywhere (`nowIso()` `sqlite.mjs:187`) | keep `TEXT` in v1 | e2e string comparisons pass unchanged; `timestamptz` conversion is a separate, later migration (tracked, not Phase A) |
| Partial unique index `billing_ref ... WHERE ref IS NOT NULL` (`sqlite.mjs:134`) | identical syntax supported | no change |
| `INSERT OR IGNORE`-style dedupe in `notifyUser` (`notifications.ts:32-34`: SELECT-then-INSERT) | fine as-is | optional `ON CONFLICT DO NOTHING` hardening later |
| `ALTER TABLE ... ADD COLUMN` idempotent migrations via `PRAGMA table_info` (`sqlite.mjs:159-184`) | `information_schema.columns` guard | same pattern in `scripts/pg/` |
| `AUTOINCREMENT`-less TEXT PKs (`uuid()`/`cuidish()` `sqlite.mjs:188-189`) | same | app-generated PKs unchanged |

## A1.3 Postgres 16 DDL strategy

- `scripts/pg/002_tables.sql` mirrors `sqlite.mjs:18-155` 1:1 (same table/column names, same defaults, plus §A1.4 additions) — so `mapX()` row mappers (`sqlite.mjs:214-275`) work unmodified.
- Roles: `bb_migrator` (owner; runs DDL), `bb_app` (app; `NOBYPASSRLS`, no ownership), `bb_system` (webhook/reaper/seed; GUC-per-operation, see §A2.1). `FORCE ROW LEVEL SECURITY` is applied so even the owner is constrained once policies go live — system jobs always set explicit GUCs.
- Rollback for the DDL itself: `scripts/pg/901_rollback.sql` drops the `big_brother` database objects; the storage flag (A1.5) is the operational rollback.

## A1.4 Prisma schema diff (before → after, concrete)

Full before/after; models not listed have **no diff** (explicitly noted where the brief might expect one).

```prisma
// ============ CHANGED: Organization  (schema.prisma:12-38) ============
model Organization {
  // ... all existing fields unchanged (name, slug, type, plan, planStatus,
  //     planRenewsAt, stripeCustomerId, stripeSubscriptionId, joinCode,
  //     reviewQueueEnabled, createdAt, updatedAt)
+ // Org offboarding (crypto-shredding workflow, §A2.4): mirrors the user-level
+ // 7-day pattern that already exists on User.deleteScheduledAt (schema.prisma:86)
+ deleteScheduledAt DateTime?
+ deletedAt         DateTime?   // set when shred+redact completes (tombstone)
+ keys              OrgEncryptionKey[]
}

// ============ NEW: OrgEncryptionKey  (§A2.3 envelope encryption) ============
model OrgEncryptionKey {
  id         String    @id @default(cuid())
  orgId      String
  org        Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  keyVersion Int                    // monotonically increasing per org
  wrappedDek String                 // DEK wrapped by KMS KEK (never a raw key)
  // active | retired (no new writes) | destroyed (crypto-shredded, §A2.4)
  state      String    @default("active")
  createdAt  DateTime  @default(now())
  destroyedAt DateTime?
  @@unique([orgId, keyVersion])
}

// ============ CHANGED: Document  (schema.prisma:200-216) ============
model Document {
  // ... existing: id, caseId, name, hash, size, mime, hashedAt,
  //     metaRisk, notes, version, previousId, createdAt  (ALL unchanged)
+ // A3 object-originals (null when OBJECT_STORAGE_ENABLED=false → hash-only mode)
+ storageKey      String?   // s3://bucket/org/{orgId}/case/{caseId}/{docId}/v{n}-{sha256}
+ storageVersionId String?  // S3/MinIO versionId (object-lock evidence)
+ storageClass    String?   // STANDARD | GLACIER_IR (aging policy)
+ retentionUntil  DateTime? // WORM object-lock retain-until (compliance mode)
+ deletedAt       DateTime? // metadata purge marker (blob survives WORM, DEK shredded)
+ virusScanStatus String?   // pending | clean | infected | skipped
+ virusScanAt     DateTime?
}

// ============ CHANGED: BillingEvent  (schema.prisma:43-52) ============
model BillingEvent {
  // ... existing unchanged
+ seq BigInt @default(autoincrement()) // Postgres replacement for rowid ordering (C-A5)
}

// ============ CHANGED: Notification  (schema.prisma:57-77) ============
model Notification {
  // ... existing unchanged
+ seq BigInt @default(autoincrement()) // Postgres replacement for rowid ordering (C-A5)
}

// ============ NO DIFF (explicit) ============
// User:            deleteScheduledAt already exists (schema.prisma:86) — brief's
//                  premise confirmed; reaper is code, not schema (§A2.4).
// Case:            opponentPleading encrypted IN PLACE (prefix scheme, §A2.3) —
//                  no new column, so existing SELECTs/UPDATEs are untouched.
// PackDraft:       payload encrypted IN PLACE — same scheme; payloadEncrypted
//                  flag deliberately NOT added (prefix `enc:v1:<kv>:...` is
//                  self-describing and backward-compatible).
// LegalProvision:  global corpus — untouched by tenancy (C-A9).
// Acknowledgment, Consent, CaseEvent, Deadline, Feedback, Membership: unchanged
//                  (RLS policies cover them via user_id / parent-case joins).
```

Plus A0 parity work on `schema.prisma` itself: add `@@map`/`@map` so every model/column maps to the physical snake_case names (C-A6) — documentation-only, no runtime effect.

## A1.5 Zero-downtime migration runbook

**Decision: dump-restore + flag cutover. Dual-write is rejected for Phase A.**

Rationale: single-writer SQLite (B1), modest data volume, and a hard requirement that the 98 checks pass on both backends make dual-write pure risk (two sources of truth, no SQLite transactions spanning HTTP requests, divergence-repair tooling) for a dataset that restores in minutes. The flag (`STORAGE_BACKEND=sqlite|pg`) is the cutover and the rollback.

| Step | Action | Guardrail |
|---|---|---|
| 1 | Deploy pg-capable build with `STORAGE_BACKEND=sqlite` (default). Behavior identical; e2e green on both backends in CI (PA-01). | 98 checks unchanged |
| 2 | Provision Postgres 16; run `scripts/pg/001..006` as `bb_migrator`; smoke e2e against a scratch DB (PA-02). | RLS enforced from first boot |
| 3 | **Cutover window** (minutes): maintenance banner → stop writes (503 on mutating routes via env flag, reads stay up) → final `sqlite.mjs` → Postgres dump-restore script (see below) → verify → flip `STORAGE_BACKEND=pg` → restart. | window measured, typically < 5 min |
| 4 | Dump-restore script `scripts/pg/migrate-from-sqlite.mjs`: attach SQLite read-only (`node:sqlite`, same module, B1) → stream rows table-by-table in dependency order (organizations → users → memberships → legal_provisions → cases → case_events → documents → deadlines → pack_drafts → acknowledgments → feedbacks → consents → audit_logs → billing_events → notifications) → per-table count + checksum verification (`PA-01` harness reuse). | restore is idempotent (TRUNCATE + reload) |
| 5 | Verify: row counts equal; `sha256` spot-checks on documents.hash; e2e full suite against the pg-backed server → `ALL CHECKS PASSED`. | 98 checks unchanged |
| 6 | **Rollback plan**: flip `STORAGE_BACKEND=sqlite` and restart — the SQLite file was never modified after step 3's freeze. Any writes that happened in pg during a short-lived post-cutover period are re-played by re-running the *forward* dump-restore with pg as source (script is bidirectional by parameter). | documented, tested in staging |
| 7 | Decommission window ends; keep SQLite file read-only for 30 days as forensic backup, then archive. | audit trail intact |

**The 7-day deletion workflow mid-migration (B6)**: `users.delete_scheduled_at` is a timestamp carried by dump-restore like any row — a user who schedules on SQLite before cutover lands in Postgres with the same value, and the reaper (§A2.4) evaluates it wherever it lives. Because step 3 freezes writes during the copy and the flag flip is atomic, there is **no state in which a deletion is lost or double-executed**: the reaper is idempotent per user (completed = `deletedAt` set + audit row `data.delete.completed`), and mid-window users simply remain login-blocked (existing 403 branch, B6) across the cutover. One addition: the reaper **must not run concurrently on both backends** — it takes a Postgres advisory lock (`pg_try_advisory_lock`) in pg mode and a file lock in sqlite mode; runbook requires it enabled on exactly one instance.

---

# A2. Tenant hardening

## A2.1 Row-Level Security

### Role model

| Role | Used by | Properties |
|---|---|---|
| `bb_migrator` | `scripts/pg/*.sql`, migrations, dump-restore | table owner; RLS-**forced** tables still constrain it post-`FORCE` — DDL windows happen before `FORCE` is applied |
| `bb_app` | all HTTP routes via `requireOrg` / `requireSession` | `NOLOGIN`-style least privilege, `NOBYPASSRLS`; can only see rows the GUCs allow |
| `bb_system` | `/api/billing/webhook` (C-A8), reaper, seed, KB global writes | owner-equivalent operational role; **must** set `app.org_id` per operation — never relied on as blanket bypass once `FORCE` is on |

### GUC middleware (extends the single org-resolution path — C-A4)

- `requireOrg()` (`api-helpers.ts:21-31`) gains the tenant-tx step shown in §A1.1: `SET LOCAL app.org_id / app.user_id / app.role`, then the handler body runs inside that tx via `AsyncLocalStorage`. **No second org-resolution path is added**; the GUC value is *only* ever the server-derived `session.orgId` after `getMembershipRole` succeeds (`db.ts:42`) — never a header, never a body field (T-17 proves client-supplied `orgId` is ignored, matching today's behavior in `cases/route.ts` where org comes from `guard.ctx`).
- Routes without `requireOrg`: `/api/auth/*` (login/register — user-scoped only, `app.user_id` set after credential verify), `/api/health` (system read), `/api/billing/webhook` (C-A8: `bb_system`, sets `app.org_id` from the **signature-verified** Stripe metadata, `webhook/route.ts:36-41`), `/api/kb/*` (global corpus reads — see P13).

### RLS DDL (concrete, per table)

```sql
-- scripts/pg/004_rls_policies.sql  (outline executed as bb_migrator; order matters)

-- P1 organizations: visible if it is the active org OR I hold any membership in it
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;  ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY org_read ON organizations FOR SELECT USING (
  id = current_setting('app.org_id', true)
  OR EXISTS (SELECT 1 FROM memberships m
             WHERE m.org_id = id AND m.user_id = current_setting('app.user_id', true)));
-- INSERT: only via SECURITY DEFINER app_create_org() (registration tx, auth/register route);
-- UPDATE: active org + OWNER/ADMIN (plan fields already gated in app code, db.ts:253 setOrgPlan)
CREATE POLICY org_update ON organizations FOR UPDATE USING (
  id = current_setting('app.org_id', true) AND current_setting('app.role', true) IN ('OWNER','ADMIN'));

-- P2 memberships: my memberships across orgs (switch-org needs them, api-helpers uses db.ts:34-45)
--    + all memberships of the active org (reviewer fan-out, notifications.ts:106)
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;  ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memb_read ON memberships FOR SELECT USING (
  org_id = current_setting('app.org_id', true)
  OR user_id = current_setting('app.user_id', true));

-- P3 users: my own row + people I share an org with (review queues display names)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;  ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY user_read ON users FOR SELECT USING (
  id = current_setting('app.user_id', true)
  OR EXISTS (SELECT 1 FROM memberships a JOIN memberships b
             ON a.org_id = b.org_id
             WHERE a.user_id = current_setting('app.user_id', true)
               AND b.user_id = id));
-- writes to users: SECURITY DEFINER app_register_user() / app_schedule_delete() only

-- P4 cases: direct org equality (this is the anchor table; org filter callers already
--    re-check in app code, e.g. documents/route.ts:14 — C-A4 keeps both layers)
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;  ALTER TABLE cases FORCE ROW LEVEL SECURITY;
CREATE POLICY case_all ON cases FOR ALL
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

-- P5-P7 case children WITHOUT org_id column: EXISTS-through-parent (no denormalization
--    churn; indexes below make the probe an index scan)
ALTER TABLE case_events  ENABLE ROW LEVEL SECURITY;  ALTER TABLE case_events  FORCE ROW LEVEL SECURITY;
ALTER TABLE documents    ENABLE ROW LEVEL SECURITY;  ALTER TABLE documents    FORCE ROW LEVEL SECURITY;
ALTER TABLE deadlines    ENABLE ROW LEVEL SECURITY;  ALTER TABLE deadlines    FORCE ROW LEVEL SECURITY;
CREATE POLICY ev_all ON case_events FOR ALL USING (
  EXISTS (SELECT 1 FROM cases c WHERE c.id = case_events.case_id
          AND c.org_id = current_setting('app.org_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM cases c WHERE c.id = case_events.case_id
          AND c.org_id = current_setting('app.org_id', true)));
-- documents / deadlines: identical shape (doc_all / dl_all)

-- P8 feedbacks: same EXISTS-through-parent (case-scoped, sqlite.mjs:108-114)
CREATE POLICY fb_all ON feedbacks FOR ALL USING (
  EXISTS (SELECT 1 FROM cases c WHERE c.id = feedbacks.case_id
          AND c.org_id = current_setting('app.org_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM cases c WHERE c.id = feedbacks.case_id
          AND c.org_id = current_setting('app.org_id', true)));

-- P9 pack_drafts: carries its own org_id (schema.prisma:242-261) → direct equality
ALTER TABLE pack_drafts ENABLE ROW LEVEL SECURITY;  ALTER TABLE pack_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY draft_all ON pack_drafts FOR ALL
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

-- P10 notifications: doubly scoped — org AND recipient (per-user inbox, B8)
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;  ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notif_all ON notifications FOR ALL USING (
  org_id = current_setting('app.org_id', true)
  AND user_id = current_setting('app.user_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true)
  AND user_id = current_setting('app.user_id', true));

-- P11 billing_events: direct org equality (ledger reads db.ts:227-229)
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;  ALTER TABLE billing_events FORCE ROW LEVEL SECURITY;
CREATE POLICY bill_all ON billing_events FOR ALL
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

-- P12 audit_logs: org rows only for tenant GUCs; NULL-org system rows invisible
--     (C-A3 resolved at the policy level; redaction policy in §A2.4)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;  ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_logs FOR SELECT
  USING (org_id = current_setting('app.org_id', true));
CREATE POLICY audit_insert ON audit_logs FOR INSERT
  WITH CHECK (org_id = current_setting('app.org_id', true));
-- no UPDATE/DELETE policy → the audit trail is physically append-only under bb_app

-- P13 legal_provisions: GLOBAL corpus (C-A9) — authenticated read, no org GUC;
--     writes go through bb_system SECURITY DEFINER fns; the LAWYER-role gate
--     stays in app code (api-helpers.ts:47 canVerify — unchanged)
ALTER TABLE legal_provisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY prov_read ON legal_provisions FOR SELECT
  USING (current_setting('app.user_id', true) IS NOT NULL);

-- P14 acknowledgments / consents: personal evidence (PRD 5.6 AC4 / 5.1 AC3) — user-scoped
ALTER TABLE acknowledgments ENABLE ROW LEVEL SECURITY;  ALTER TABLE acknowledgments FORCE ROW LEVEL SECURITY;
ALTER TABLE consents       ENABLE ROW LEVEL SECURITY;  ALTER TABLE consents       FORCE ROW LEVEL SECURITY;
CREATE POLICY ack_all ON acknowledgments FOR ALL
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));
CREATE POLICY consent_all ON consents FOR ALL
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));

-- P15 org_encryption_keys: NEVER readable by bb_app at all
REVOKE ALL ON org_encryption_keys FROM bb_app;
-- (access only via SECURITY DEFINER fns app_get_org_dek(org) / app_rotate_org_key(org))

-- Supporting indexes for the EXISTS probes (mirrors sqlite.mjs:63,71,79,87 + adds feedbacks)
CREATE INDEX IF NOT EXISTS idx_cases_org ON cases(org_id);
CREATE INDEX IF NOT EXISTS idx_events_case ON case_events(case_id);
CREATE INDEX IF NOT EXISTS idx_docs_case ON documents(case_id);
CREATE INDEX IF NOT EXISTS idx_deadlines_case ON deadlines(case_id);
CREATE INDEX IF NOT EXISTS idx_feedbacks_case ON feedbacks(case_id);
CREATE INDEX IF NOT EXISTS idx_memb_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memb_org ON memberships(org_id);
```

**Missing-GUC semantics**: every policy uses `current_setting('app.org_id', true)` (no-throw, returns NULL) — an unset GUC yields NULL comparison → **zero rows**, fail-closed. PA-04 verifies this directly against the pool.

## A2.2 Existing code that conflicts with RLS/encryption (flagged, not silently changed)

1. **`getCaseById` has no org filter** (`db.ts:59`, C-A4) — under RLS the row simply disappears for foreign orgs, which is correct; the call sites that *rely* on fetching-then-checking still work, but any code path that treats `null` as "create it" would misbehave — audited in A1; the e2e T-suite (§A2.5) is the regression net.
2. **`getOrgUsage` counts via `audit_logs`** (`db.ts:217-219`: `analysis.run` metering) — audit table under RLS is org-scoped so counting still works, **but** the webhook/reaper (`bb_system`) and NULL-org rows are invisible to `bb_app`; no current usage counter depends on system rows — flagged so future metering doesn't silently under-count.
3. **`notifyUser` inserts with orgId taken from callers** (`notifications.ts:32-47`) — WITH CHECK P10 requires `org_id = app.org_id AND user_id = app.user_id`; reviewer fan-out inserts rows for *other* users (`notifications.ts:106-125`), which would violate P10's WITH CHECK under `bb_app`. **Resolution (design change, flagged)**: cross-recipient fan-out moves into a `SECURITY DEFINER` function `app_notify(user, org, payload)` that re-validates both the actor's membership and the recipient's membership in the *same* org server-side; the lib keeps its signature. This is the one place where RLS forces a code change beyond the driver — it is called out so it isn't discovered mid-build.
4. **Sessions are stateless** (C-A7) — RLS can't revoke a stolen cookie; the `sessions_invalid_before` fix (A2.5 T-21) is scheduled in this phase, not deferred.
5. **`stripeConfigured`/demo mode** (`billing.ts:82`) — demo-mode checkout writes org plan rows from an authenticated OWNER/ADMIN context (fine under P1), but the *webhook* path writes cross-org under `bb_system` (C-A8); the T-20 replay test pins the boundary.
6. **Text dates** (A1.2) — `current_setting` returns text; comparing to text `org_id` columns is native. No conflict, noted to preempt "why not uuid type" churn.

## A2.3 Per-tenant envelope encryption

**Design** (extends TAS §Tenant hardening; implemented at the **application layer**, so it composes with RLS — RLS stops wrong-tenant *reads*; encryption makes a stolen DB file / backup / snapshot unreadable even where RLS doesn't reach):

```
KMS (Vault Transit  ─  self-hosted, containerized next to the app
     or AWS KMS     ─  if the deployment lands on AWS)          [human decision §5.4]
   └─ KEK (key-encryption key, never leaves KMS)
        └─ wraps per-org DEK (AES-256) → wrapped_dek in org_encryption_keys
             └─ encrypts fields per row: AES-256-GCM
```

- **Fields encrypted** (per the brief): `Case.opponentPleading` (`schema.prisma:165` — opposing counsel's argument text is the most sensitive free text), `PackDraft.payload` (`schema.prisma:249` — full JSON draft content), and `Document` contents-metadata introduced by A3 (`storageKey` is encrypted-at-rest? **No** — `storageKey`/`hash` stay plaintext so integrity checks and WORM remain operable; what's encrypted is the *object body* inside MinIO via SSE-C with the org DEK, see §A3). Voice-note audio bodies follow the same SSE-C path (B5).
- **Ciphertext scheme (self-describing, backward-compatible — no schema flag needed)**:
  `enc:v1:<keyVersion>:<base64(iv || ciphertext || gcm-tag)>`
  Readers split on `:`; values without the prefix are legacy plaintext (decrypt-on-read fallback = PA-07; this is what makes `ENCRYPTION_ENABLED` a safe, reversible flag on existing rows).
- **AAD tenant binding**: every GCM call binds additional authenticated data = `org|table|column|rowId`. Consequences: (a) a ciphertext copied into another org's row **fails to decrypt** (cross-tenant ciphertext-swap attack defeated at the crypto layer, complementing T-02..T-09 at the query layer); (b) a ciphertext moved between columns fails; (c) no nonce/keystore bookkeeping beyond the prefix.
- **Key lifecycle**:
  - *On org create* (SECURITY DEFINER `app_create_org`, §A2.1-P1): generate DEK, wrap with KEK, insert `org_encryption_keys(org, keyVersion=1, state='active')` (new model, §A1.4).
  - *KEK rotation* (cheap, recommended quarterly): Vault `transit/rewrap` re-wraps every org's DEK — zero data re-encryption; runbook = one script + audit row `kms.kek.rotated`.
  - *DEK rotation* (per org, on demand or annual): new `keyVersion=n+1` becomes active; background job re-encrypts the org's encrypted fields (row counts are small: drafts + case fields); old version → `state='retired'` until re-encrypt completes → `destroyed`. Read path tries the keyVersion named in the prefix, so old rows decrypt during migration.
  - *Dev fallback*: `KMS_PROVIDER=dev` stores the master key in a local file so the suite runs without Vault — the 98 checks stay green in the sandbox; prod requires `vault|aws` (env matrix §A4.5).
- **What this changes in code**: a `src/lib/crypto.ts` (encrypt/decrypt/dekCache) + two hook points: draft create/update (payload), case create/update (opponentPleading), object-store SSE-C key (A3). `packs.ts`/`counterReply.ts` continue to see plaintext objects — the facade decrypts transparently on read, so **no UI or engine change** (engine purity untouched, B-method).

## A2.4 Crypto-shredding on org deletion — reconciled with the 7-day workflow and the immutable audit trail

**Current state (verified)**: user-level scheduling exists (`data/delete/route.ts:19-29`, B6) but nothing completes it (C-A2); workspace purge is immediate (`:31-36`). Org-level deletion does not exist.

**New unified reaper** (`scripts/reaper.mjs` + `app_execute_delete()` SECURITY DEFINER; advisory-locked per §A1.5):

```
for each user/org where deleteScheduledAt <= now - 7d and deletedAt is null:
  1. double-check block: still scheduled (no cancel recorded), after grace re-verify
  2. revoke access: users.sessions_invalid_before = now (C-A7 fix; login 403 branch B6 stays)
  3. shred: KMS destroy DEK (org) → org_encryption_keys.state='destroyed',
     destroyedAt=now  → every GCM ciphertext of that org becomes permanently undecryptable
  4. redact: NULL/redact PII columns on the org's surviving skeleton rows (table below)
  5. delete: workspace rows that are not audit/evidence-skeleton (mirror of the
     existing workspace purge, data/delete/route.ts:31-36, but org-wide)
  6. WORM: sealed evidence objects STAY in object storage until retentionUntil
     (§A3) — but their SSE-C key was the shredded DEK → effectively destroyed
  7. audit: append data.delete.completed (system GUC, append-only P12)
```

**What survives and why that is legally sufficient**:

| Survivor | Fields kept | Why |
|---|---|---|
| `audit_logs` rows | `at`, `action`, `org_id`, `user_id` (opaque ids), **redacted** `detail` | The trail *is* the compliance evidence (PRD §6.7; P12 makes it append-only). Redaction policy (C-A3): details carry ids/hashes/kinds only — no case numbers, names, or free text. Human sign-off required (§5.2). |
| `Document` skeleton | `id, caseId→null, hash, size, mime, version, previousId, hashedAt, metaRisk, storageKey, retentionUntil, deletedAt` (name/notes nulled) | Preserves the **evidentiary chain** (SHA-256 chain, PRD 5.9): anyone can later prove what was sealed and that WORM was never broken — while the content is cryptographically gone. |
| WORM object | bytes until `retentionUntil` (object-lock COMPLIANCE) | Cannot be deleted even by root (§A3.3); with the DEK shredded it is high-entropy garbage — deletion right honored in substance (CITRA user-rights alignment, PRD §7) while tamper-evidence persists. |
| `Organization` tombstone | `id, slug(redacted suffix), plan='DELETED', deleteScheduledAt, deletedAt, createdAt` | Prevents slug reuse attacks (old join codes / deep links resolve to a dead org, not a new stranger's org). |
| `Acknowledgment` rows | redacted to `id, kind, bannerVersion, acceptedAt` (textSnapshot truncated to banner version hash) | Proof the user accepted the educational-output banner (PRD 5.6 AC4) without retaining content. |

**Why sufficient**: the retained records contain no personal data beyond opaque ids and timestamps, so the deletion right is substantively honored; they still prove (1) consent/acknowledgment happened, (2) evidence was sealed and never altered (hash chain + WORM), (3) deletion was executed on schedule. Final wording is a legal-counsel decision (§5.2) — flagged, not assumed.

**Reconciliation with user-level 7-day flow**: `mode:"account"` (user) and org offboarding share the same reaper; user deletion shreds *their* personal data and, when they are the org's last member, cascades to org shredding; org deletion (new `POST /api/orgs/[id]/delete`, OWNER-only, double-confirmed) schedules the org itself. Login stays blocked through the whole window (existing 403 branch, B6).

## A2.5 Cross-tenant attack test plan — 22 new e2e checks (T-01..T-22)

Harness fit: appended to `scripts/e2e.mjs` as **section [12] "Tenant hardening (Phase A)"**, reusing the isolated-org pattern of section [10] (`e2e.mjs:267-271`): create victim org **V** (via `POST /api/orgs`) with a case, event, document pair, draft, notification, billing event; create attacker org **A**; keep both sessions switchable via `switch-org`. Existing conventions preserved: 404 for foreign resources (no existence oracle), 401 for bad sessions, 403 for role failures.

| # | Check (request → expected) |
|---|---|
| T-01 | Tamper with the session cookie payload (swap `orgId` in the b64url body, keep old HMAC) → any `/api/*` returns **401** (signature check, `auth.ts:26-41`). |
| T-02 | Attacker session `GET /api/cases/{V-caseId}` → **404** (no existence oracle). |
| T-03 | IDOR sweep: attacker iterates all V case ids across `/api/cases/{id}/analysis` → every one **404**. |
| T-04 | Attacker `POST /api/cases/{V-caseId}/events` → **404** (write-path IDOR). |
| T-05 | Attacker `POST /api/cases/{V-caseId}/documents` (seal) → **404**. |
| T-06 | Attacker `GET /api/cases/{V-caseId}/documents` → **404**. |
| T-07 | Attacker `POST /api/cases/{V-caseId}/drafts` (with valid ack) → **404** (ack gate irrelevant; tenancy first). |
| T-08 | Attacker `POST /api/drafts/{V-draftId}/export` → **404** (never 409/423 — status must not leak lifecycle state). |
| T-09 | Attacker `POST /api/drafts/{V-draftId}/release` → **404** even when attacker holds LAWYER role in org A. |
| T-10 | Attacker `GET /api/cases/{V-caseId}/deadlines-ics` → **404**. |
| T-11 | Attacker `POST /api/cases/{V-caseId}/voice-note` → **404**. |
| T-12 | Attacker `POST /api/feedback {caseId: V-caseId}` → **404** (caseId validated against active org — today's behavior confirmed, now pinned). |
| T-13 | Attacker marks V's notification read: `POST /api/notifications {id: V-notifId}` → `marked: 0` + **404** shape (recipient scoping, `notifications.ts:194-204`). |
| T-14 | Attacker `GET /api/notifications` → response contains **zero** rows referencing V case/draft ids (scrub assertion). |
| T-15 | Attacker `POST /api/auth/switch-org {orgId: V-orgId}` (no membership) → **403** (membership check, `api-helpers.ts:29`). |
| T-16 | Join-code enumeration: attacker sends 5 malformed/guessed `joinCode`s to `switch-org` → **404** each, identical error shape (no oracle); correct-code path still 200 for the legit member. |
| T-17 | Attacker `POST /api/cases {..., orgId: V-orgId}` → **201** but returned/stored `orgId === A-orgId` (client-supplied orgId ignored — GUC `app.org_id` is the only write scope; WITH CHECK P4). |
| T-18 | Attacker `GET /api/audit` → zero rows with `org_id = V` (P12 scoping; also asserts NULL-org system rows are invisible). |
| T-19 | Billing isolation: attacker `GET /api/billing` → ledger has no V refs; attacker cannot reach V's summary by any id (no such route param exists — assert 404 on fabricated id path). |
| T-20 | Webhook replay across orgs: with `STRIPE_WEBHOOK_SECRET` set in the test env, POST a **validly signed** `checkout.session.completed` for org V (metadata.orgId=V) → 200 + PRO; replay the **same event id** with metadata rewritten to org A → still 200 but `ignored`/no-op (idempotent `ref`, `webhook/route.ts:57` + `db.ts:232-240`); ledger shows exactly one new row, attributed to V; a **badly signed** body → **400**. |
| T-21 | Switched-session replay: capture attacker cookie → `POST /api/auth/logout` → replay the captured cookie → **401** (requires the `sessions_invalid_before` fix, C-A7; today's code would pass the replay — this check documents the fix). |
| T-22 | Object-storage tenancy (post-A4): attacker requests presigned download of V's document → **404**; a presigned URL minted inside V is requested with attacker's session → API **404**; object keys are org-prefixed and the bucket policy denies cross-prefix reads (storage-level assert in the script). |

**Session-derivation attack** (login as A, immediately request with V's data in body) is covered by T-17; **cookie forgery** by T-01; **replay** by T-20/T-21. Full section adds 22 checks → see §A4.4 for the complete Phase A numbering.

---

# A3. Document originals storage (S3-compatible: MinIO self-host / S3 cloud)

## A3.1 The gap, precisely

Today nothing but the hash survives a seal: `documents/route.ts:19-23` states "only hash + metadata are stored, never the file content itself", and the audio path says the same (`voice-note/route.ts`, B5). That is a deliberate CITRA-minimisation choice (PRD §7) — Phase A does **not** reverse it; it makes originals *opt-in per deployment* behind `OBJECT_STORAGE_ENABLED`, with the hash-only mode as the default fallback so the 98 checks pass unchanged in the sandbox. When enabled, the seal contract is unchanged: same SHA-256 over the exact bytes (`sqlite.mjs:191`), same version chain (`documents/route.ts:48-51`), same mismatch flag, same `notifyDocumentIntegrity` call (`:64-68`).

## A3.2 Upload flow (extends the existing POST, same route)

```
POST /api/cases/[id]/documents            (multipart or existing raw-body)
  1. requireOrg → tenant tx (GUC)                       [api-helpers.ts:21-31, extended]
  2. plan limit check (402 plan_limit)                  [documents/route.ts:41-46 — unchanged]
  3. stream to temp file (size cap DOC_MAX_UPLOAD_MB)   [replaces in-memory arrayBuffer, C-A10]
  4. virus-scan hook (ClamAV clamd):
       clean    → continue;  infected → 422 + audit document.infected + notify owner
       no scanner configured → virusScanStatus='skipped' (dev) | 503 (prod, fail-closed)
  5. sha256 over exact bytes                            [sqlite.mjs:191 — the seal]
  6. PUT object s3://bb-docs/{orgId}/{caseId}/{docId}/v{n}-{sha256}
       SSE-C with the org DEK (§A2.3) · object-lock COMPLIANCE mode
       retain-until = retentionUntil (now + DOC_RETENTION_YEARS)
  7. INSERT documents row + storageKey/storageVersionId/storageClass/
     retentionUntil/virusScan* fields (§A1.4 diff)      [extends documents/route.ts:54-57]
  8. version chain + mismatch flag                      [documents/route.ts:48-51 — unchanged]
  9. audit document.seal + notifyDocumentIntegrity      [documents/route.ts:59-68 — unchanged]
```

Idempotency: `Idempotency-Key` header → `documents.idempotency_key` unique partial index (same pattern as `billing_events.ref`, `sqlite.mjs:134`) — a retried upload cannot double-seal or double-store.

Voice-note (`voice-note/route.ts`) gets the identical treatment (steps 3–7) behind the same flag; its **consent 428 gate is preserved verbatim** (PRD 5.1 AC3/AC4).

## A3.3 WORM / retention-lock vs deletion rights

- Bucket `bb-docs` created with **object-lock enabled, default mode COMPLIANCE**: once sealed, the object cannot be shortened, altered, or deleted — including by root — before `retentionUntil`. This is the storage-side twin of the append-only audit policy (P12) and the never-overwritten version chain (`db.ts:169-197` pattern).
- **Reconciliation with deletion rights** (mirrors §A2.4 step 6): user/org deletion removes *metadata and access* (row redacted, `deletedAt` set, presigned minting impossible, tenant prefix revoked), while the WORM blob remains but is bound to the org DEK via SSE-C; the reaper shreds that DEK → the retained bytes are cryptographically unrecoverable. Result: "effectively destroyed" for the user, "provably unaltered" for the court record.
- Retention length (`DOC_RETENTION_YEARS`) and COMPLIANCE-vs-GOVERNANCE mode are legal decisions (§5.1/§5.3) — the design supports both modes; COMPLIANCE is the recommended default for evidence originals.
- Interaction with e2e section [8]: the existing `workspace wipe works` check (`e2e.mjs:185-186`) deletes rows only; with object storage on, blobs persist under WORM — check stays green (it asserts the API response, not blob absence).

## A3.4 API contract — extensions to `/api/cases/[id]/documents`

| Method & path | Auth | Purpose | Notes |
|---|---|---|---|
| `POST /api/cases/[id]/documents` | member of org (any role) | seal+store (multipart, or legacy raw-body when object storage off) | 201 `{document, hashMismatch}`; 402 plan_limit; 422 infected; 428 n/a; errors preserve existing shapes |
| `GET /api/cases/[id]/documents` | member | list (adds `storageKey?`, `virusScanStatus`, `retentionUntil` fields) | existing handler, extended mapper |
| `GET /api/cases/[id]/documents/[docId]/download` | member | **302 → presigned GET (300s TTL)** or stream-proxy fallback | audits `document.download`; 404 cross-tenant (T-22) |
| `POST /api/cases/[id]/documents/presign` | OWNER/ADMIN | direct-upload presign: `{uploadUrl, docId, key}` (client PUTs, then `POST` finalize with claimed sha256) | server verifies object hash == claimed before sealing (seal integrity never delegated to client) |

All four are org-scoped via the same `requireOrg` tenant-tx (§A2.1); no new org-resolution path (C-A4).

---

# A4. Deliverables

## A4.1 Ordered migration plan (each step independently shippable + rollback)

| Phase | Ships | Rollback | e2e delta |
|---|---|---|---|
| **A0** | `docker-compose` (postgres 16 + minio + vault dev), `scripts/pg/001..006` SQL, `schema.prisma` `@@map` parity (C-A6), `.env.example` additions | delete files; no runtime change | 0 |
| **A1** | `storage/` driver interface + pg-driver behind `STORAGE_BACKEND=pg` (default sqlite); `seq` columns (C-A5); dump-restore script | flag flip | +4 (PA-01..04) |
| **A2** | RLS DDL + GUC tenant-tx in `requireOrg` + `app_notify`/`app_create_org` SECURITY DEFINER fns + session revocation (`sessions_invalid_before`) | `RLS_ENFORCED=false` (policies remain dormant), flag flip | +22 (T-01..22) |
| **A3** | `src/lib/crypto.ts` envelope encryption (`ENCRYPTION_ENABLED`), `opponentPleading` + `payload` encryption, `org_encryption_keys`, key-rotation script | flag off (legacy rows readable either way) | +4 (PA-05..08) |
| **A4** | Object storage: multipart+presign upload, download, WORM, virus-scan hook, voice-note parity (`OBJECT_STORAGE_ENABLED`) | flag off → hash-only mode exactly as today | +2 (PA-09..10) |
| **A5** | Deletion reaper + crypto-shred + org offboarding + tombstones | reaper disabled via env (no other rollback needed — it only executes already-scheduled deletions) | +2 (PA-11..12) |

Total: **+34 checks → 132**. Every phase is a separate commit+push; the 98 existing checks must pass after **each** phase.

## A4.2 Prisma schema diff

Full before/after in §A1.4 (Organization, Document, BillingEvent, Notification changed; OrgEncryptionKey added; User/Case/PackDraft/LegalProvision explicitly no-diff with reasons).

## A4.3 RLS DDL script outline (`scripts/pg/`)

```
001_schemas_roles.sql      bb_migrator / bb_app / bb_system + grants
002_tables.sql             mirrors sqlite.mjs:18-155 + §A1.4 additions
003_indexes.sql            §A2.1 supporting indexes
004_rls_policies.sql       P1..P15 (§A2.1) + FORCE ROW LEVEL SECURITY
005_functions.sql          SECURITY DEFINER: app_create_org, app_register_user,
                           app_notify, app_get_org_dek, app_rotate_org_key,
                           app_execute_delete
006_grants.sql             bb_app minimal DML; REVOKE org_encryption_keys
901_rollback.sql           drop policies → tables → roles (reverse order)
```

## A4.4 e2e additions — numbered (extend the existing 98 checks)

**Section [12] — cross-tenant attack suite (22):** T-01..T-22 as specified in §A2.5.

**Section [13] — Phase A infrastructure (12):**

| # | Check |
|---|---|
| PA-01 | Dual-backend parity: full suite green against **both** `STORAGE_BACKEND=sqlite` and `=pg` (runner script asserts two `ALL CHECKS PASSED` logs) |
| PA-02 | Fresh pg seeder parity: `/api/health` returns `corpus: 48` on a newly restored Postgres DB |
| PA-03 | Pool-reuse leak test: same pg connection serves attacker then victim requests; victim sees only victim rows (GUC `SET LOCAL` correctness) |
| PA-04 | Fail-closed probe (script-level SQL): unset `app.org_id` GUC → `SELECT count(*) FROM cases` returns 0 under `bb_app` |
| PA-05 | Encryption at rest: after storing `opponentPleading`, raw row reads `enc:v1:…`; API returns plaintext |
| PA-06 | Draft payload ciphertext at rest; packs API renders plaintext; export flow unchanged (428/409/423 gates intact) |
| PA-07 | Legacy back-compat: pre-encryption row (no prefix) still reads correctly after `ENCRYPTION_ENABLED=true` |
| PA-08 | Key rotation: rotate org key → old-version rows decrypt; new writes carry new `keyVersion`; rotation audited |
| PA-09 | Object seal: with MinIO on, sealed document row carries `storageKey`; object fetched from storage hashes equal to `documents.hash` |
| PA-10 | WORM enforcement: script attempts object DELETE/overwrite as admin → storage returns ObjectLock error (COMPLIANCE mode) |
| PA-11 | Reaper execution: backdated `deleteScheduledAt` fixture (>7d) → after reaper run: login **403**, rows redacted/deleted, audit `data.delete.completed` present, DEK `destroyed` |
| PA-12 | Reaper grace: fixture scheduled 1 day ago → reaper run leaves it untouched |

## A4.5 Env/config changes

```bash
# --- A1 database ---
STORAGE_BACKEND=sqlite            # sqlite (default, dev/test) | pg
DATABASE_URL=postgresql://bb_app:…@localhost:5432/bigbrother   # required when pg
PG_POOL_MAX=10                    # bb_app pool size
PG_STATEMENT_TIMEOUT_MS=8000      # tenant-tx guardrail
# --- A2 hardening ---
RLS_ENFORCED=true                 # false only for A2 rollback window
SESSION_SECRET=                   # MANDATORY in pg mode (C-A7); boot fails without it
COOKIE_SECURE=true                # auth.ts:51 flag becomes env-driven
KMS_PROVIDER=dev                  # dev (sandbox) | vault | aws
VAULT_ADDR= VAULT_TOKEN= VAULT_TRANSIT_KEY_NAME=big-brother-kek
KMS_DEV_MASTER_KEY_FILE=./data/dev-master.key        # dev only, gitignored
ENCRYPTION_ENABLED=true
# --- A3 object storage ---
OBJECT_STORAGE_ENABLED=false      # false = today's hash-only mode (98 checks green)
S3_ENDPOINT= S3_REGION= S3_BUCKET=bb-docs
S3_ACCESS_KEY_ID= S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=true          # MinIO
DOC_MAX_UPLOAD_MB=25  DOC_RETENTION_YEARS=5          # §5 human decision
VIRUS_SCAN_PROVIDER=none          # none (dev) | clamav
CLAMAV_HOST= CLAMAV_PORT=3310
```

Feature-flag matrix guarantees: default sandbox env (`sqlite`, KMS dev, object storage off) reproduces **today's behavior exactly** — the 98 checks never depend on new infrastructure.

---

## Constraints compliance checklist

| Guardrail | Phase A impact |
|---|---|
| Non-dismissible acknowledgment gates (428 at generation **and** export) | untouched — T-07/PA-06 assert they still fire |
| 24h cooling-off + review queue (423, lawyer-only release) | untouched — export path unchanged under encryption/presign |
| Unverified-citation badges / LKB resolver | untouched — `legal_provisions` global read preserved (C-A9, P13) |
| 7-day deletion (PRD 5.10 AC1) | **strengthened**: actually completes now (C-A2 fix); behavior mid-migration specified (§A1.5) |
| Ethical billing limits (402, capacity-only) | untouched — same choke points (B7); T-19/T-20 add isolation tests around them |
| Evidence hash-chain + mismatch flagging + HIGH metaRisk alerts | extended, not replaced — same seal call, same notification hook (§A3.1) |
| Audit trail (PRD 6.7) | append-only under RLS (P12); redaction policy flagged for sign-off (C-A3) |
| `src/lib/engine.ts` | **no modification** (pure function, no storage dependency) |

## Decisions only humans can make (Phase A)

1. **Retention period** for evidence originals (`DOC_RETENTION_YEARS`) — Kuwaiti limitation periods per case class; drives WORM `retentionUntil`.
2. **Audit-detail redaction policy** (C-A3) — exact wording of what the surviving trail may contain; needs counsel sign-off (§A2.4 survivor table).
3. **WORM mode** — COMPLIANCE (immutable for everyone) vs GOVERNANCE (privileged escape hatch): recommend COMPLIANCE for evidence, but that makes early deletion impossible even for lawful takedown — a legal call.
4. **KMS provider & key custody** — self-hosted Vault Transit vs AWS KMS; who holds recovery shards; quarterly KEK rotation ownership.
5. **Session revocation mechanism** (C-A7) — `sessions_invalid_before` invalidates *all* sessions on any logout/revocation; finer-grained per-session ids are a larger auth rework — accept coarse-grained now or schedule the rework.
6. **Cutover window timing** for the dump-restore (§A1.5 step 3) — when the production deployment can tolerate a read-only interval.
7. **Org-level deletion as a user-facing right** — new capability (OWNER-initiated org offboarding); whether it appears in the UI now or remains an operations-runbook action until counsel reviews the tombstone table.
8. **MinIO hardware/sizing & bucket lifecycle** (GLACIER_IR aging, quota) for the self-hosted deployment.



