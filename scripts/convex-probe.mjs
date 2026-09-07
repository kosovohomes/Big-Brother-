// Probe: single upsert against vivid-hare-882 with full error output
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const client = new ConvexHttpClient(
  process.env.NEXT_PUBLIC_CONVEX_URL || "https://vivid-hare-882.eu-west-1.convex.cloud"
);
try {
  const stats = await client.query(api.provisions.stats, {});
  console.log("stats ok:", JSON.stringify(stats));
} catch (e) {
  const { inspect } = await import("node:util");
  console.error("PROBE FAILED:", inspect(e, { depth: 5 }));
  process.exit(1);
}
