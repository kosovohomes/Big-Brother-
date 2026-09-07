# Kuwait Legal Corpus — Cleaned Files (v1.0, UNVERIFIED)

## What these files are

Three JSON files, each containing the real article-by-article text of a Kuwaiti law, extracted and cleaned from source documents:

| File | Law | Repo lawId | Articles |
|---|---|---|---|
| `KW_CriminalProcedure_17_1960_clean.json` | Criminal Procedure Law 17/1960 | `17/1960` | 263 |
| `KW_CivilProcedure_38_1980_clean.json` | Civil & Commercial Procedure Law 38/1980 | `38/1980` | 311 |
| `KW_PenalCode_16_1960_clean.json` | Penal Code 16/1960 | `16/1960` | 293 |

Each file is a law-level header (name, source info, verification status) plus a list of articles, each with an article number and its Arabic text. `SOURCES.json` pins the sha256 of every file, the mirror-lawId → repo-lawId mapping, and the known data quirks the ingest pipeline handles.

## Where this came from

These were extracted from three source documents (a PDF and two saved webpages) that were found online and checked for legitimacy before use. They are **mirrors of a Kuwaiti legal database, not Kuwait's own government website directly** — one step removed from the primary source. The original Criminal Procedure PDF carries its own disclaimer, translated: *"Please do not consider the article presented above as official or final."*

**A fourth file that was also found (`kuwait_laws_articles.jsonl`) was discarded entirely** — on inspection it was almost entirely broken (scraping debris, cut-off text) and must never be used.

## Critical rule: these are NOT verified official text

Every file is explicitly marked `"verified_official": false` and `"verification_status": "UNVERIFIED - PENDING LAWYER REVIEW - DO NOT TREAT AS OFFICIAL TEXT"`. This label must be preserved and surfaced to the end user everywhere this content is shown in the app — do not strip it, hide it, or treat these as confirmed law.

**Before this content is relied upon for real advice to a real user, a licensed Kuwaiti lawyer must review it against the official gazette.** Until then, treat it as a strong first draft, not ground truth.

## A note on amendment history

Some articles (especially in the Penal Code file) contain both the **current amended text** and the **original pre-amendment text**, with labels like "Final text per amendment by Law X" and "Original text of the article." This is preserved intentionally — it's useful provenance, not noise. Don't strip it without understanding which version applies to a given time period.

## How Big Brother ingests these files

`node scripts/ingest-corpus.mjs` (add `--dry-run` for a no-write report; `CORPUS_DIR=<dir>` to ingest a different drop):

1. **Validates before writing** — law header fields present, `article_count` matches the actual list, and `verified_official === false`. A file that claims to be verified is REFUSED (verification only ever happens through the lawyer audit flow, never through a file attribute).
2. **Repairs known mirror damage** — re-attaches first letters glued into the Civil Procedure number field, normalizes مكرر (bis) numbering variants to `<n> مكرر`, collapses whitespace.
3. **Never duplicates existing coverage** — articles already covered by the v0.1 seed fixtures (exact numbers or ranges like `35-44`) are skipped and listed in the report for the lawyer to reconcile during Phase 0.
4. **Splits inline amendment provenance into the version chain** — for articles carrying both texts: v1 = original text (`amendmentVersion: original`, inactive, superseded), v2 = final text (`amendmentVersion: معدلة بـ…`, active, `supersedesId → v1`, mirror publication date kept in `gazette_ref`). This mirrors exactly what the lawyer amend action does (PRD 6.3a), so the KB keeps full history with one active row per article.
5. **Surfaces repeal markers without acting on them** — where the source says `ملغاة`, the row stays active + unverified with the marker in `verification_note`; only a lawyer may deactivate (the ambiguity between "article repealed" vs "amending law repealed" is a human call).
6. **Ingests everything `verified:false`** — every row lands in the Phase 0 citation-audit queue (`/api/kb/audit`) with provenance in `verification_note`, and an `lkb.ingest` audit-trail entry is written.
7. **Is idempotent** — re-running skips rows that already exist (unique `law_id, article_no, version`), so re-runs never duplicate.

Output: a per-file ingest report is written to `corpus/INGEST_REPORT.json` (ingested / skipped-fixture / skipped-duplicate / split-into-versions / repeal-marked / malformed counts, with details for the lawyer).

The app then treats these rows exactly like any other LKB provision: citations resolve through `resolveRef`, every unverified entry shows the "pending Phase 0" badge, and search/BM25 covers them.

## What's still missing

- Law 9/2020 (electronic service law) full text — only 3 fixture articles exist; a separate source would need to be found and verified the same way.
- No cross-check yet against the official Kuwait Al-Youm gazette itself — that's the actual verification step for a lawyer to do.
