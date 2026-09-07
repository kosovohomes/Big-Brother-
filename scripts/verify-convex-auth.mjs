// Task 13 — auth hardening verification against vivid-hare-882.
// 1. NEGATIVE: verify mutation WITHOUT token must fail (UNAUTHORIZED).
// 2. NEGATIVE: verify mutation with WRONG token must fail.
// 3. POSITIVE: verify with the correct token passes the gate (fake id →
//    returns null after auth; no data mutated).
// 4. READS: stats query stays public by design.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { readFileSync } from "node:fs";

const URL_ = process.env.NEXT_PUBLIC_CONVEX_URL || "https://vivid-hare-882.eu-west-1.convex.cloud";
const envLocal = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const GOOD = (envLocal.match(/^LAWYER_API_TOKEN=(.+)$/m) || [])[1]?.trim();
if (!GOOD) { console.error("✘ no token in .env.local"); process.exit(1); }


const client = new ConvexHttpClient(URL_);
let fails = 0;

// Fetch a REAL provision id so arg validation passes and the auth gate itself
// is what rejects. Negative tests never patch (gate runs first); the positive
// test uses the zero-side-effect authPing probe instead of touching a row.
const probe = await client.query(api.provisions.listByLaw, { lawId: "51/1996" });
const REAL_ID = probe[0]._id;

async function expectError(label, token) {
  try {
    await client.mutation(api.provisions.verify, {
      token, id: REAL_ID, note: "auth-test", verifiedBy: "auth-test|tester",
    });
    console.error(`✘ ${label}: mutation went through WITHOUT auth — HARDENING FAILURE`);
    fails++;
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (/UNAUTHORIZED|missing or invalid/i.test(msg)) console.log(`✔ ${label}: refused (${msg.slice(0, 80)})`);
    else { console.error(`✘ ${label}: unexpected error: ${msg.slice(0, 200)}`); fails++; }
  }
}

await expectError("NEGATIVE no-token", "");
await expectError("NEGATIVE wrong-token", "deadbeef".repeat(8));

try {
  const out = await client.mutation(api.provisions.authPing, { token: GOOD });
  console.log(`✔ POSITIVE good-token: authPing → ${JSON.stringify(out)}`);
} catch (e) {
  console.error(`✘ POSITIVE good-token rejected: ${String(e).slice(0, 200)}`);
  fails++;
}

const stats = await client.query(api.provisions.stats, {});
console.log(`✔ READ public stats: ${JSON.stringify(stats)}`);

if (fails) { console.error(`FAIL: ${fails} auth test(s) failed`); process.exit(1); }
console.log("AUTH HARDENING VERIFIED: writes token-gated, reads public, fail-closed");
