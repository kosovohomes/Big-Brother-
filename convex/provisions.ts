// =====================================================================
// Big Brother — Legal Knowledge Base functions (PRD 6.3a)
// Starter functions for the vivid-hare-882 deployment. legalProvisions
// is the SOLE citation source; rows start verified:false per RAG_SPEC.
// =====================================================================

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePrivilegedToken, auditDetail } from "./auth";

// Task 13 hardening: every mutation below takes a `token` argument and
// validates it against the deployment's LAWYER_API_TOKEN env (fail-closed
// if unset — see convex/auth.ts). Public READS remain open by design: the
// LKB is meant to be browsable; only writes are privileged.

export const listByLaw = query({
  args: { lawId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("legalProvisions")
      .withIndex("by_law_article", (q) => q.eq("lawId", args.lawId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("legalProvisions") },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

// ---- read surface mirroring src/lib/db.ts (Phase A facade parity) ----

// getAllActiveProvisions: active rows only.
export const listAllActive = query({
  args: {},
  handler: async (ctx) =>
    await ctx.db
      .query("legalProvisions")
      .withIndex("by_active_verified", (q) => q.eq("isActive", true))
      .collect(),
});

export const countActive = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("legalProvisions")
      .withIndex("by_active_verified", (q) => q.eq("isActive", true))
      .collect();
    return rows.length;
  },
});

// getProvisionsByLaw: active rows, law-optional, ordered lawId → articleNo.
export const listByLawActive = query({
  args: { lawId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const q = ctx.db.query("legalProvisions");
    const rows = args.lawId
      ? await q
          .withIndex("by_law_article", (x) => x.eq("lawId", args.lawId!))
          .filter((x) => x.eq(x.field("isActive"), true))
          .collect()
      : await q
          .withIndex("by_active_verified", (x) => x.eq("isActive", true))
          .collect();
    return rows.sort(
      (a, b) =>
        a.lawId.localeCompare(b.lawId) ||
        Number(a.articleNo) - Number(b.articleNo) ||
        a.articleNo.localeCompare(b.articleNo)
    );
  },
});

// getAllProvisions: full history including superseded (audit "archived" view).
export const listAllHistory = query({
  args: { lawId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const rows = args.lawId
      ? await ctx.db
          .query("legalProvisions")
          .withIndex("by_law_article", (x) => x.eq("lawId", args.lawId!))
          .collect()
      : await ctx.db.query("legalProvisions").collect();
    return rows.sort(
      (a, b) =>
        a.lawId.localeCompare(b.lawId) ||
        a.articleNo.localeCompare(b.articleNo, undefined, { numeric: true }) ||
        a.version - b.version
    );
  },
});

// findProvision: active rows for (lawId, articleNo) — resolution path.
export const findActive = query({
  args: { lawId: v.string(), articleNo: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("legalProvisions")
      .withIndex("by_law_article", (x) =>
        x.eq("lawId", args.lawId).eq("articleNo", args.articleNo)
      )
      .filter((x) => x.eq(x.field("isActive"), true))
      .collect();
    return rows;
  },
});

// getAuditStats parity: totals per law split by active/verified.
export const auditStats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("legalProvisions").collect();
    const out: {
      total: number; verified: number; pending: number; superseded: number;
      byLaw: Record<string, { total: number; verified: number }>;
    } = { total: 0, verified: 0, pending: 0, superseded: 0, byLaw: {} };
    for (const p of all) {
      if (!out.byLaw[p.lawId]) out.byLaw[p.lawId] = { total: 0, verified: 0 };
      if (p.isActive) {
        out.total++;
        out.byLaw[p.lawId].total++;
        if (p.verified) {
          out.verified++;
          out.byLaw[p.lawId].verified++;
        } else out.pending++;
      } else out.superseded++;
    }
    return out;
  },
});

// getKbStatsByLaw parity: active counts grouped by law + verified total.
export const kbStatsByLaw = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("legalProvisions")
      .withIndex("by_active_verified", (x) => x.eq("isActive", true))
      .collect();
    const byLaw: Record<string, number> = {};
    let verified = 0;
    for (const p of rows) {
      byLaw[p.lawId] = (byLaw[p.lawId] ?? 0) + 1;
      if (p.verified) verified++;
    }
    return { byLaw, total: rows.length, verified };
  },
});

// Counts for the /api/kb/stats parity surface.
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("legalProvisions").collect();
    return {
      total: all.length,
      verified: all.filter((p) => p.verified).length,
      unverified: all.filter((p) => !p.verified).length,
      active: all.filter((p) => p.isActive).length,
      laws: [...new Set(all.map((p) => p.lawId))].sort(),
    };
  },
});

// Upsert on the (lawId, articleNo, version) unique triple — Convex has no
// declarative uniques, so we enforce via the by_law_article_version index.
export const upsert = mutation({
  args: {
    token: v.string(), // privileged-write gate (LAWYER_API_TOKEN)
    lawId: v.string(),
    lawNameAr: v.string(),
    lawNameEn: v.string(),
    articleNo: v.string(),
    titleAr: v.string(),
    titleEn: v.string(),
    textAr: v.string(),
    textEn: v.string(),
    amendmentVersion: v.optional(v.string()),
    gazetteRef: v.optional(v.string()),
    summaryAr: v.optional(v.string()),
    summaryEn: v.optional(v.string()),
    topics: v.optional(v.array(v.string())),
    version: v.optional(v.number()),
    supersedesId: v.optional(v.id("legalProvisions")),
    // verification fields are never settable at ingest (verified:false gate)
  },
  handler: async (ctx, args) => {
    requirePrivilegedToken(args.token);
    const now = Date.now();
    const version = args.version ?? 1;
    const existing = await ctx.db
      .query("legalProvisions")
      .withIndex("by_law_article_version", (q) =>
        q
          .eq("lawId", args.lawId)
          .eq("articleNo", args.articleNo)
          .eq("version", version)
      )
      .first();

    if (existing) {
      // Full-history retention: never overwrite text of an existing row here;
      // new amendment versions must be inserted with version+1 instead.
      return { id: existing._id, action: "exists" as const };
    }

    const id = await ctx.db.insert("legalProvisions", {
      lawId: args.lawId,
      lawNameAr: args.lawNameAr,
      lawNameEn: args.lawNameEn,
      articleNo: args.articleNo,
      amendmentVersion: args.amendmentVersion ?? "original",
      gazetteRef: args.gazetteRef,
      titleAr: args.titleAr,
      titleEn: args.titleEn,
      textAr: args.textAr,
      textEn: args.textEn,
      summaryAr: args.summaryAr ?? "",
      summaryEn: args.summaryEn ?? "",
      topics: args.topics ?? [],
      verified: false,
      version,
      supersedesId: args.supersedesId,
      isActive: true,
      createdAt: now,
    });
    await ctx.db.insert(
      "auditLogs",
      auditDetail(
        "lkb.convex.ingest",
        `${args.lawId} م${args.articleNo} v${version} inserted (token-authenticated upsert, verified:false)`
      )
    );
    return { id, action: "created" as const };
  },
});

// ---- Phase 0 lawyer workflow (writes) — mirrors db.ts verify/deactivate/-----
// reactivate/amend. verifiedBy arrives pre-composed as "userId|name" for
// parity with the SQLite facade. Dates arrive as ISO strings, stored as ms.

// Zero-side-effect privileged probe: lets the server/UI/scripts health-check
// the token gate without touching any row (Task 13 hardening).
export const authPing = mutation({
  args: { token: v.string() },
  handler: async (_ctx, args) => {
    requirePrivilegedToken(args.token);
    return { ok: true as const, at: Date.now() };
  },
});

function isoToMs(v?: string | null): number | undefined {
  if (!v) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

export const verify = mutation({
  args: {
    token: v.string(), // privileged-write gate (LAWYER_API_TOKEN)
    id: v.id("legalProvisions"),
    note: v.string(),
    gazetteRef: v.optional(v.string()),
    effectiveFrom: v.optional(v.string()),
    effectiveTo: v.optional(v.string()),
    verifiedBy: v.string(), // "userId|name"
  },
  handler: async (ctx, args) => {
    requirePrivilegedToken(args.token);
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    await ctx.db.patch(args.id, {
      verified: true,
      verificationNote: args.note,
      gazetteRef: args.gazetteRef ?? row.gazetteRef,
      effectiveFrom: isoToMs(args.effectiveFrom) ?? row.effectiveFrom,
      effectiveTo: isoToMs(args.effectiveTo),
      verifiedBy: args.verifiedBy,
      verifiedAt: Date.now(),
    });
    await ctx.db.insert(
      "auditLogs",
      auditDetail(
        "lkb.convex.verify",
        `${row.lawId} م${row.articleNo} v${row.version} → verified by ${args.verifiedBy} (token-authenticated)`
      )
    );
    return await ctx.db.get(args.id);
  },
});

export const deactivate = mutation({
  args: { token: v.string(), id: v.id("legalProvisions"), note: v.string(), actor: v.string() },
  handler: async (ctx, args) => {
    requirePrivilegedToken(args.token);
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    await ctx.db.patch(args.id, {
      isActive: false,
      verified: false,
      verifiedBy: args.actor,
      verifiedAt: Date.now(),
      verificationNote: args.note,
    });
    await ctx.db.insert(
      "auditLogs",
      auditDetail("lkb.convex.deactivate", `${row.lawId} م${row.articleNo} v${row.version} → deactivated by ${args.actor}: ${args.note}`)
    );
    return await ctx.db.get(args.id);
  },
});

export const reactivate = mutation({
  args: { token: v.string(), id: v.id("legalProvisions"), actor: v.string() },
  handler: async (ctx, args) => {
    requirePrivilegedToken(args.token);
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    await ctx.db.patch(args.id, {
      isActive: true,
      verifiedBy: args.actor,
      verifiedAt: Date.now(),
      verificationNote: `reactivated for further review by ${args.actor}`,
    });
    await ctx.db.insert(
      "auditLogs",
      auditDetail("lkb.convex.reactivate", `${row.lawId} م${row.articleNo} v${row.version} → reactivated by ${args.actor}`)
    );
    return await ctx.db.get(args.id);
  },
});

// Amend = publish a new version (lawyer-reviewed) and retire the old row.
// Convex mutations are transactional: both writes commit atomically.
export const amend = mutation({
  args: {
    token: v.string(), // privileged-write gate (LAWYER_API_TOKEN)
    id: v.id("legalProvisions"),
    titleAr: v.optional(v.string()),
    titleEn: v.optional(v.string()),
    textAr: v.string(),
    textEn: v.string(),
    note: v.string(),
    gazetteRef: v.optional(v.string()),
    effectiveFrom: v.optional(v.string()),
    verifiedBy: v.string(), // "userId|name"
  },
  handler: async (ctx, args) => {
    requirePrivilegedToken(args.token);
    const prev = await ctx.db.get(args.id);
    if (!prev) return { provision: null, previous: null };
    const newVersion = prev.version + 1;
    const now = Date.now();
    const newId = await ctx.db.insert("legalProvisions", {
      lawId: prev.lawId,
      lawNameAr: prev.lawNameAr,
      lawNameEn: prev.lawNameEn,
      articleNo: prev.articleNo,
      amendmentVersion: `amendment-v${newVersion}`,
      effectiveFrom: isoToMs(args.effectiveFrom) ?? prev.effectiveFrom,
      gazetteRef: args.gazetteRef ?? prev.gazetteRef,
      titleAr: args.titleAr?.trim() || prev.titleAr,
      titleEn: args.titleEn?.trim() || prev.titleEn,
      textAr: args.textAr,
      textEn: args.textEn,
      summaryAr: "مُعدّلة ومُوثّقة من محامٍ في المرحلة صفر / Amended & verified by a lawyer in Phase 0",
      summaryEn: "Amended & verified by a lawyer in Phase 0",
      topics: prev.topics ?? [],
      verified: true,
      verificationNote: args.note,
      verifiedBy: args.verifiedBy,
      verifiedAt: now,
      version: newVersion,
      supersedesId: prev._id,
      isActive: true,
      createdAt: now,
    });
    await ctx.db.patch(prev._id, {
      isActive: false,
      effectiveTo: now,
      verificationNote: `superseded by amendment v${newVersion} — retired by ${args.verifiedBy.split("|")[1] ?? args.verifiedBy}`,
    });
    await ctx.db.insert(
      "auditLogs",
      auditDetail(
        "lkb.convex.amend",
        `${prev.lawId} م${prev.articleNo} v${prev.version} → v${newVersion} by ${args.verifiedBy} (token-authenticated; supersedes, history retained)`
      )
    );
    return { provision: await ctx.db.get(newId), previous: await ctx.db.get(prev._id) };
  },
});
