// Convex bridge for the Legal Knowledge Base (Phase A: convex-native LKB).
// The rest of the app stays on the sqlite/pg drivers; the LKB functions in
// db.ts branch here when LKB_BACKEND=convex (default). Row shapes mirror
// sqlite.mjs mapProvision exactly so callers (engine, kb routes) cannot tell
// the backends apart. Convex dates are epoch ms — mapped back to ISO strings.
//
// Deployment: dev:vivid-hare-882 (eu-west-1) — seeded with 995 provisions,
// all verified:false (Phase 0 gate; sign-off via provisions:verify only).

import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";

export const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL || "https://vivid-hare-882.eu-west-1.convex.cloud";

/** Which backend serves LKB reads/writes: "convex" (default) | "sqlite". */
export const lkbBackend = (): "convex" | "sqlite" =>
  (process.env.LKB_BACKEND as "convex" | "sqlite" | undefined) || "convex";

let client: ConvexHttpClient | null = null;

/** Server-side singleton (Next.js node runtime; keep out of client bundles). */
export function getConvexClient(): ConvexHttpClient {
  if (!client) client = new ConvexHttpClient(CONVEX_URL);
  return client;
}

type ProvisionDoc = Doc<"legalProvisions">;
export type ConvexProvisionId = Id<"legalProvisions">;

const msToIso = (v?: number | null): string | undefined =>
  typeof v === "number" ? new Date(v).toISOString() : undefined;

/** Convex doc → row shape identical to sqlite.mjs mapProvision output. */
export function mapConvexProvision(d: ProvisionDoc) {
  return {
    id: d._id,
    lawId: d.lawId,
    lawNameAr: d.lawNameAr,
    lawNameEn: d.lawNameEn,
    articleNo: d.articleNo,
    amendmentVersion: d.amendmentVersion,
    effectiveFrom: msToIso(d.effectiveFrom),
    effectiveTo: msToIso(d.effectiveTo),
    gazetteRef: d.gazetteRef,
    titleAr: d.titleAr,
    titleEn: d.titleEn,
    textAr: d.textAr,
    textEn: d.textEn,
    summaryAr: d.summaryAr ?? "",
    summaryEn: d.summaryEn ?? "",
    topics: d.topics ?? [],
    verified: !!d.verified,
    verificationNote: d.verificationNote,
    verifiedBy: d.verifiedBy,
    verifiedAt: msToIso(d.verifiedAt),
    version: d.version,
    supersedesId: d.supersedesId,
    isActive: !!d.isActive,
    createdAt: msToIso(d.createdAt) ?? new Date(d._creationTime).toISOString(),
  };
}
export type ConvexProvisionRow = ReturnType<typeof mapConvexProvision>;

// ---------- LKB read surface (parity with db.ts) ----------

export const convexGetAllActiveProvisions = async () =>
  (await getConvexClient().query(api.provisions.listAllActive, {})).map(mapConvexProvision);

export const convexGetActiveProvisionCount = async (): Promise<number> =>
  await getConvexClient().query(api.provisions.countActive, {});

export const convexGetProvisionsByLaw = async (lawId?: string) =>
  (await getConvexClient().query(api.provisions.listByLawActive, { lawId })).map(mapConvexProvision);

export const convexGetAllProvisions = async (lawId?: string) =>
  (await getConvexClient().query(api.provisions.listAllHistory, { lawId })).map(mapConvexProvision);

export const convexFindProvision = async (lawId: string, article: string) =>
  (
    await getConvexClient().query(api.provisions.findActive, { lawId, articleNo: article })
  ).map(mapConvexProvision);

export const convexGetProvisionById = async (id: string): Promise<ConvexProvisionRow | null> => {
  try {
    const row = await getConvexClient().query(api.provisions.get, { id: id as ConvexProvisionId });
    return row ? mapConvexProvision(row) : null;
  } catch (e) {
    // Malformed id strings (e.g. garbage in a URL path) fail Convex's
    // v.id() ARGUMENT validation before existence is ever checked — map
    // that to "not found" so routes 404 instead of 500 (Task 13 smoke).
    // Real outages (network/deployment down) still propagate.
    if (/does not match validator|InvalidConvexId/i.test(String((e as Error)?.message ?? e))) return null;
    throw e;
  }
};

export const convexGetAuditStats = async () =>
  await getConvexClient().query(api.provisions.auditStats, {});

export const convexGetKbStatsByLaw = async () =>
  await getConvexClient().query(api.provisions.kbStatsByLaw, {});

// ---------- Phase 0 lawyer workflow (write surface) ----------

/**
 * Server-only shared secret for privileged Convex mutations (Task 13
 * hardening). The token is set on the deployment via `npx convex env set
 * LAWYER_API_TOKEN ...` and mirrored in .env.local (never NEXT_PUBLIC_,
 * never shipped to the browser). Fail-closed: refuse writes when unset.
 */
function privilegedToken(): string {
  const t = process.env.LAWYER_API_TOKEN;
  if (!t) {
    throw new Error(
      "LAWYER_API_TOKEN is not set in the server environment — privileged Convex writes are refused (fail-closed). See docs/SECURITY-CONVEX.md."
    );
  }
  return t;
}

export const convexVerifyProvision = async (
  id: string,
  input: {
    note: string; gazetteRef?: string; effectiveFrom?: string; effectiveTo?: string;
    verifiedBy: string; verifiedByName: string;
  }
): Promise<ConvexProvisionRow | null> => {
  const row = await getConvexClient().mutation(api.provisions.verify, {
    token: privilegedToken(),
    id: id as ConvexProvisionId,
    note: input.note,
    gazetteRef: input.gazetteRef,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    verifiedBy: `${input.verifiedBy}|${input.verifiedByName}`,
  });
  return row ? mapConvexProvision(row) : null;
};

export const convexDeactivateProvision = async (
  id: string, note: string, actor: string
): Promise<ConvexProvisionRow | null> => {
  const row = await getConvexClient().mutation(api.provisions.deactivate, {
    token: privilegedToken(),
    id: id as ConvexProvisionId, note, actor,
  });
  return row ? mapConvexProvision(row) : null;
};

export const convexReactivateProvision = async (
  id: string, actor: string
): Promise<ConvexProvisionRow | null> => {
  const row = await getConvexClient().mutation(api.provisions.reactivate, {
    token: privilegedToken(),
    id: id as ConvexProvisionId, actor,
  });
  return row ? mapConvexProvision(row) : null;
};

export const convexAmendProvision = async (
  id: string,
  input: {
    titleAr?: string; titleEn?: string; textAr: string; textEn: string;
    note: string; gazetteRef?: string; effectiveFrom?: string;
    verifiedBy: string; verifiedByName: string;
  }
): Promise<{ provision: ConvexProvisionRow | null; previous: ConvexProvisionRow | null }> => {
  const out = await getConvexClient().mutation(api.provisions.amend, {
    token: privilegedToken(),
    id: id as ConvexProvisionId,
    titleAr: input.titleAr,
    titleEn: input.titleEn,
    textAr: input.textAr,
    textEn: input.textEn,
    note: input.note,
    gazetteRef: input.gazetteRef,
    effectiveFrom: input.effectiveFrom,
    verifiedBy: `${input.verifiedBy}|${input.verifiedByName}`,
  });
  return {
    provision: out.provision ? mapConvexProvision(out.provision) : null,
    previous: out.previous ? mapConvexProvision(out.previous) : null,
  };
};
