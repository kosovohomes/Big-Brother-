// =====================================================================
// Big Brother — Convex schema (mirror of prisma/schema.prisma, Phase A parity)
// Deployment: vivid-hare-882 (https://vivid-hare-882.convex.cloud)
//
// Mirrors all 19 Prisma models as Convex document tables. Field names are
// kept identical to the Prisma model fields (camelCase). SQLite/Postgres
// remain the runtime DBs for the Next.js app until the data layer is
// swapped; this deployment is the cloud mirror.
//
// Conventions:
// - DateTime  → v.number() (epoch ms)
// - JSON cols → native arrays where practical (topics), string JSON where
//   parity with the existing pipeline matters (stats, payload, embedding)
// - cuid PKs  → Convex-generated ids (v.id across tables)
// - Unique constraints are enforced in mutations via the listed indexes
//   (Convex has no declarative unique constraints)
// =====================================================================

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ===================== Multi-tenant SaaS (Tenancy) =====================

  organizations: defineTable({
    name: v.string(),
    slug: v.string(), // unique — enforce in mutations via by_slug
    type: v.string(), // INDIVIDUAL | NGO | LAW_FIRM
    plan: v.string(), // FREE | PRO
    planStatus: v.optional(v.string()), // active | canceled | past_due
    planRenewsAt: v.optional(v.number()),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    joinCode: v.string(), // unique — enforce via by_join_code
    reviewQueueEnabled: v.boolean(),
    deleteScheduledAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_join_code", ["joinCode"]),

  billingEvents: defineTable({
    orgId: v.id("organizations"),
    at: v.number(),
    kind: v.string(), // upgrade | downgrade | webhook.checkout.session.completed | ...
    plan: v.string(),
    detail: v.optional(v.string()),
    ref: v.optional(v.string()), // unique (Stripe event id) — enforce via by_ref
    seq: v.number(), // newest-first ordering (C-A5)
  })
    .index("by_org", ["orgId"])
    .index("by_ref", ["ref"]),

  notifications: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    type: v.string(), // deadline.reminder | draft.review_requested | ...
    dedupeKey: v.string(), // unique per user — enforce via by_user_dedupe
    titleAr: v.string(),
    titleEn: v.string(),
    bodyAr: v.optional(v.string()),
    bodyEn: v.optional(v.string()),
    caseId: v.optional(v.string()),
    refType: v.optional(v.string()),
    refId: v.optional(v.string()),
    urgency: v.optional(v.string()), // overdue | critical | soon | high | medium | low
    readAt: v.optional(v.number()),
    createdAt: v.number(),
    seq: v.number(),
  })
    .index("by_user_org", ["userId", "orgId"])
    .index("by_user_dedupe", ["userId", "dedupeKey"]),

  users: defineTable({
    email: v.string(), // unique — enforce via by_email
    passwordHash: v.string(),
    name: v.string(),
    locale: v.string(), // default "ar"
    deleteScheduledAt: v.optional(v.number()),
    sessionsInvalidBefore: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_email", ["email"]),

  memberships: defineTable({
    userId: v.id("users"),
    orgId: v.id("organizations"),
    role: v.string(), // OWNER | ADMIN | CASEWORKER | LAWYER | MEMBER
  })
    .index("by_user", ["userId"])
    .index("by_org", ["orgId"])
    .index("by_user_org", ["userId", "orgId"]), // unique pair — enforce here

  // ============== Legal Knowledge Base (PRD 6.3a — sole citation source) ==============

  legalProvisions: defineTable({
    lawId: v.string(), // e.g. "38/1980", "51/1996", "9/2020"
    lawNameAr: v.string(),
    lawNameEn: v.string(),
    articleNo: v.string(), // "163", "257-260", "P-1"
    amendmentVersion: v.string(), // default "original"
    effectiveFrom: v.optional(v.number()),
    effectiveTo: v.optional(v.number()), // null = current version
    gazetteRef: v.optional(v.string()),
    titleAr: v.string(),
    titleEn: v.string(),
    textAr: v.string(),
    textEn: v.string(),
    summaryAr: v.optional(v.string()),
    summaryEn: v.optional(v.string()),
    topics: v.optional(v.array(v.string())),
    verified: v.boolean(), // false until Phase 0 citation audit signs off
    verificationNote: v.optional(v.string()),
    verifiedBy: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
    version: v.number(), // default 1
    supersedesId: v.optional(v.id("legalProvisions")),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_law_article", ["lawId", "articleNo"])
    .index("by_law_article_version", ["lawId", "articleNo", "version"]) // unique triple
    .index("by_active_verified", ["isActive", "verified"]),

  // ===================== Case management =====================

  cases: defineTable({
    orgId: v.id("organizations"),
    ownerId: v.id("users"),
    number: v.string(),
    court: v.string(),
    circuit: v.optional(v.string()),
    caseType: v.string(), // civil | criminal | family
    subType: v.string(), // execution | debt | family | labour | commercial | ...
    role: v.string(), // default "defendant"
    filedAt: v.optional(v.string()),
    servedAt: v.optional(v.string()),
    opponent: v.optional(v.string()),
    opponentPleading: v.optional(v.string()), // encrypted at rest (enc:v1:...)
    subjectName: v.optional(v.string()),
    intakeChannel: v.string(), // self | ngo_assisted | voice_note
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_owner", ["ownerId"])
    .index("by_number", ["number"]),

  caseEvents: defineTable({
    caseId: v.id("cases"),
    date: v.string(), // ISO date
    title: v.string(),
    type: v.string(), // filing | service | session | judgment | ...
    note: v.optional(v.string()),
    appealFiled: v.boolean(),
    defect: v.boolean(),
    createdAt: v.number(),
  }).index("by_case", ["caseId"]),

  // Immutable evidence log (PRD 5.9): SHA-256 + UTC timestamp
  documents: defineTable({
    caseId: v.id("cases"),
    name: v.string(),
    hash: v.string(),
    size: v.number(),
    mime: v.optional(v.string()),
    hashedAt: v.string(), // UTC ISO
    metaRisk: v.string(), // LOW | MEDIUM | HIGH
    notes: v.optional(v.string()),
    version: v.number(),
    previousId: v.optional(v.id("documents")),
    createdAt: v.number(),
    storageKey: v.optional(v.string()),
    storageVersionId: v.optional(v.string()),
    storageClass: v.optional(v.string()),
    retentionUntil: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    virusScanStatus: v.optional(v.string()), // pending | clean | infected | skipped
    virusScanAt: v.optional(v.number()),
    idempotencyKey: v.optional(v.string()), // unique — enforce via by_idem
  })
    .index("by_case", ["caseId"])
    .index("by_hash", ["hash"])
    .index("by_idem", ["idempotencyKey"]),

  // Deadline Radar (derived + manual deadlines; iCal export)
  deadlines: defineTable({
    caseId: v.id("cases"),
    titleAr: v.string(),
    titleEn: v.string(),
    dueAt: v.string(), // ISO datetime
    kind: v.string(), // appeal | opposition | session | custom
    provisionRef: v.optional(v.string()),
    completed: v.boolean(),
    sourceEventId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_case", ["caseId"])
    .index("by_due", ["dueAt"]),

  // ===================== Two-layer outputs (PRD 5.5/5.6/6.6) =====================

  packDrafts: defineTable({
    caseId: v.id("cases"),
    orgId: v.id("organizations"),
    createdById: v.id("users"),
    type: v.string(), // counter | dismissal | evidence | misconduct | nazaha | combined
    titleAr: v.string(),
    titleEn: v.string(),
    payload: v.string(), // JSON document payload (encrypted at rest upstream)
    status: v.string(), // DRAFT | FINALIZED | IN_REVIEW | RELEASED | EXPORTED
    finalizedAt: v.optional(v.string()),
    releasedAt: v.optional(v.string()),
    exportedAt: v.optional(v.string()),
    coolingOffHours: v.number(),
    reviewRequired: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_case", ["caseId"])
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"]),

  // Mandatory acknowledgment log (PRD 5.6 AC4)
  acknowledgments: defineTable({
    userId: v.id("users"),
    draftId: v.optional(v.id("packDrafts")),
    kind: v.string(), // DRAFT_GENERATION | EXPORT | CONSENT
    bannerVersion: v.string(),
    textSnapshot: v.string(),
    acceptedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_draft", ["draftId"]),

  // User feedback loop (PRD 5.3 AC3 / 5.5 AC4)
  feedbacks: defineTable({
    userId: v.id("users"),
    caseId: v.id("cases"),
    targetType: v.string(), // alert | ground
    targetId: v.string(),
    value: v.string(), // helpful | not_helpful | needs_facts
    createdAt: v.number(),
  })
    .index("by_case", ["caseId"])
    .index("by_user", ["userId"]),

  // Consent record (PRD 5.1 AC3)
  consents: defineTable({
    userId: v.id("users"),
    caseId: v.optional(v.id("cases")),
    scope: v.string(), // case_data | voice_note | ngo_assisted
    version: v.string(),
    textSnapshot: v.string(),
    acceptedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Full audit logs (PRD 6.7) — append-only by convention (no update/delete mutations)
  auditLogs: defineTable({
    orgId: v.optional(v.id("organizations")),
    userId: v.optional(v.id("users")),
    at: v.number(),
    action: v.string(),
    detail: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_action", ["action"])
    .index("by_at", ["at"]),

  // ============== Phase A A2.3: per-tenant envelope encryption ==============

  orgEncryptionKeys: defineTable({
    orgId: v.id("organizations"),
    keyVersion: v.number(), // monotonic per org — unique pair via by_org_version
    wrappedDek: v.string(), // DEK wrapped by KMS KEK
    state: v.string(), // active | retired | destroyed
    createdAt: v.number(),
    destroyedAt: v.optional(v.number()),
  }).index("by_org_version", ["orgId", "keyVersion"]),

  // ============== RAG Phase 1 (docs/RAG_SPEC.md §4.1) — additive ==============
  // RAG chunks are RETRIEVAL PROPOSALS ONLY — legalProvisions remains the
  // sole citation source of truth.

  ragChunks: defineTable({
    provisionId: v.optional(v.id("legalProvisions")),
    lawId: v.string(),
    articleNo: v.string(),
    articlePart: v.number(),
    chapterHeading: v.optional(v.string()),
    amendmentVersion: v.string(),
    effectiveFrom: v.optional(v.number()),
    effectiveTo: v.optional(v.number()),
    gazetteIssue: v.optional(v.string()),
    gazetteDate: v.optional(v.number()),
    textCanonical: v.string(),
    textNormalized: v.string(),
    textHash: v.string(),
    embedding: v.optional(v.string()), // JSON array Phase 1; vector search Phase R0
    ocrEngine: v.optional(v.string()),
    ocrConfidence: v.optional(v.number()),
    ingestJobId: v.id("ingestJobs"),
    isActive: v.boolean(),
    status: v.string(), // CHUNKED | EMBEDDED | LIVE | REJECTED
    createdAt: v.number(),
  })
    .index("by_law_article", ["lawId", "articleNo"])
    .index("by_job", ["ingestJobId"])
    .index("by_law_article_part_hash", ["lawId", "articleNo", "articlePart", "textHash"]),

  ingestJobs: defineTable({
    manifestHash: v.string(), // unique (idempotency, RAG-16) — enforce via by_manifest
    issueNo: v.string(),
    publishDate: v.number(),
    sourceType: v.string(), // txt | pdf | ...
    sourcePath: v.string(),
    sourceSha256: v.string(),
    status: v.string(), // DISCOVERED | BLOCKED_POLICY | REJECTED | CHUNKED | LAWYER_REVIEW | EMBEDDED | INDEXED | LIVE
    attested: v.boolean(), // false = provisional mirror source, never LIVE
    ocrEngine: v.optional(v.string()),
    stats: v.optional(v.string()), // JSON
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_manifest", ["manifestHash"])
    .index("by_status", ["status"]),

  provisionAmendments: defineTable({
    amendingLawId: v.optional(v.string()),
    amendingArticle: v.optional(v.string()),
    targetLawId: v.string(),
    targetArticle: v.string(),
    action: v.string(), // REPLACE | INSERT | REPEAL | RENUMBER | RESTATE | GENERAL_REPEAL
    gazetteIssue: v.optional(v.string()),
    gazetteDate: v.optional(v.number()),
    newProvisionId: v.optional(v.id("legalProvisions")),
    appliedAt: v.optional(v.number()),
    detectedBy: v.string(), // default "pipeline"
    approvedBy: v.optional(v.string()), // lawyer gate before any application
    ingestJobId: v.optional(v.id("ingestJobs")),
    createdAt: v.number(),
  }).index("by_target", ["targetLawId", "targetArticle"]),

  ragQueryLog: defineTable({
    orgId: v.optional(v.id("organizations")),
    queryHash: v.string(), // sha256(normalized query) — query TEXT is never stored
    latencyMs: v.optional(v.number()),
    embedMode: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),
});
