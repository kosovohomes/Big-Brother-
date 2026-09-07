#!/usr/bin/env python3
# Dump legal_provisions from data/big-brother.db to JSON for Convex seeding.
# Maps snake_case columns -> Convex upsert args (camelCase). Skips store-local
# fields (supersedes_id cuids, effective dates — not in upsert contract).
import sqlite3, json
from datetime import datetime

con = sqlite3.connect("/home/z/my-project/data/big-brother.db")
con.row_factory = sqlite3.Row
rows = con.execute(
    """select law_id, article_no, law_name_ar, law_name_en, title_ar, title_en,
              text_ar, text_en, amendment_version, gazette_ref, summary_ar,
              summary_en, topics, version, verified, is_active, created_at
       from legal_provisions
       order by law_id, cast(article_no as real), version"""
).fetchall()

def to_ms(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v) if v > 1e12 else int(v * 1000)  # s or ms
    s = str(v).strip()
    if s.isdigit():
        n = int(s)
        return n if n > 1e12 else n * 1000
    try:
        return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return None

out = []
for r in rows:
    topics = json.loads(r["topics"]) if r["topics"] else []
    doc = {
        "lawId": r["law_id"],
        "articleNo": str(r["article_no"]),
        "lawNameAr": r["law_name_ar"] or "",
        "lawNameEn": r["law_name_en"] or "",
        "titleAr": r["title_ar"] or "",
        "titleEn": r["title_en"] or "",
        "textAr": r["text_ar"] or "",
        "textEn": r["text_en"] or "",
        "amendmentVersion": r["amendment_version"] or "original",
        "summaryAr": r["summary_ar"] or "",
        "summaryEn": r["summary_en"] or "",
        "topics": topics,
        "version": r["version"] or 1,
        "verified": False,          # Convex gate: verification only via provisions:verify
        "isActive": bool(r["is_active"]) if r["is_active"] is not None else True,
    }
    if r["gazette_ref"]:
        doc["gazetteRef"] = r["gazette_ref"]
    ca = to_ms(r["created_at"])
    if ca:
        doc["createdAt"] = ca
    out.append(doc)

with open("/home/z/my-project/scripts/convex-seed-dump.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
print("dumped", len(out), "provisions")
