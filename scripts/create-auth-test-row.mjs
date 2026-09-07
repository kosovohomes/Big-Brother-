// One-off: create the auth-plumbing synthetic test row (Task 13).
import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const TOKEN = (env.match(/^LAWYER_API_TOKEN=(.+)$/m) || [])[1].trim();
const client = new ConvexHttpClient(
  process.env.NEXT_PUBLIC_CONVEX_URL || "https://vivid-hare-882.eu-west-1.convex.cloud"
);
const r = await client.mutation(api.provisions.upsert, {
  token: TOKEN,
  lawId: "ZZ/1900",
  lawNameAr: "صف اختبار — مسار التوثيق",
  lawNameEn: "Auth plumbing test row",
  articleNo: "TEST",
  titleAr: "صف اختبار المصادقة (يُؤرشف تلقائيًا)",
  titleEn: "auth test row",
  textAr: "هذا صف اصطناعي للتحقق من بوابة التوكن الخاصة بمسار التوثيق عبر واجهة التطبيق، يُؤرشف فور الاختبار.",
  textEn: "Synthetic row for the token-gated verify-path test; archived immediately after.",
});
console.log("synthetic row:", JSON.stringify(r));
const q = await client.query(api.provisions.listByLaw, { lawId: "ZZ/1900" });
console.log("listByLaw ZZ/1900:", q.length, "row(s)");
