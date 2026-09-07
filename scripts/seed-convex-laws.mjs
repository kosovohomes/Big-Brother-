// =====================================================================
// Big Brother — seed Convex legalProvisions from SQLite LKB dump
// Usage: node scripts/seed-convex-laws.mjs   (after: python3 scripts/dump_provisions.py)
// Source: scripts/convex-seed-dump.json (995 rows, 7 laws — full parity with data/big-brother.db)
// Idempotent: upsert returns "exists" for already-seeded (lawId, articleNo, version).
// Every row lands verified:false per the RAG_SPEC gate (lawyer sign-off only
// via provisions:verify); the one "ملغاة" repeal-marker row is preserved as-is.
// =====================================================================

import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const DUMP = new URL("./convex-seed-dump.json", import.meta.url);
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://vivid-hare-882.eu-west-1.convex.cloud";
const BATCH = 10;

// Task 13 hardening: upsert is a privileged mutation — token required
// (LAWYER_API_TOKEN from env or parsed out of .env.local).
function loadToken() {
  if (process.env.LAWYER_API_TOKEN) return process.env.LAWYER_API_TOKEN;
  try {
    const envLocal = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const m = envLocal.match(/^LAWYER_API_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  } catch { /* no .env.local */ }
  console.error("✘ LAWYER_API_TOKEN not found (env or .env.local) — privileged upsert will be refused");
  return "";
}
const TOKEN = loadToken();

async function main() {
  const rows = JSON.parse(readFileSync(DUMP, "utf8"));
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("empty dump");
  console.log(`seeding ${rows.length} provisions → ${CONVEX_URL}`);

  const client = new ConvexHttpClient(CONVEX_URL);
  let created = 0, exists = 0;
  const perLaw = {};

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const results = await Promise.all(
      chunk.map((r) =>
        client.mutation(api.provisions.upsert, {
          token: TOKEN,
          lawId: r.lawId,
          lawNameAr: r.lawNameAr,
          lawNameEn: r.lawNameEn,
          articleNo: r.articleNo,
          titleAr: r.titleAr,
          titleEn: r.titleEn,
          textAr: r.textAr,
          textEn: r.textEn,
          amendmentVersion: r.amendmentVersion,
          gazetteRef: r.gazetteRef ?? undefined,
          summaryAr: r.summaryAr,
          summaryEn: r.summaryEn,
          topics: r.topics,
          version: r.version,
        })
      )
    );
    for (const res of results) {
      if (res.action === "created") created++;
      else exists++;
    }
    const done = Math.min(i + BATCH, rows.length);
    if (done % 100 === 0 || done === rows.length) console.log(`  ${done}/${rows.length}`);
  }

  // verify per-law parity vs dump
  const dumpCounts = {};
  for (const r of rows) dumpCounts[r.lawId] = (dumpCounts[r.lawId] || 0) + 1;
  const stats = await client.query(api.provisions.stats, {});
  console.log("--- live stats ---");
  console.log(JSON.stringify(stats, null, 2));

  let parity = true;
  for (const [lawId, n] of Object.entries(dumpCounts)) {
    const liveRows = await client.query(api.provisions.listByLaw, { lawId });
    perLaw[lawId] = liveRows.length;
    if (liveRows.length !== n) {
      parity = false;
      console.error(`PARITY FAIL: ${lawId} live=${liveRows.length} dump=${n}`);
    }
  }
  console.log("--- per-law parity ---", JSON.stringify(perLaw));

  if (!parity || stats.total !== rows.length) {
    throw new Error("seed parity check failed");
  }
  console.log(
    exists === 0
      ? `SEEDED OK (first run): ${created} created`
      : `SEEDED OK (idempotent re-run): ${exists} exists, ${created} created`
  );
}

main().catch((e) => {
  import("node:util").then(({ inspect }) => {
    console.error("SEED FAILED:", inspect(e, { depth: 4 }));
    process.exit(1);
  });
});
