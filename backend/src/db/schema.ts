/**
 * VERDICT — Drizzle ORM schema (Postgres)
 *
 * This database is the INDEXED / DERIVED layer, not the source of truth for
 * money or verdicts. The GenLayer Intelligent Contract on StudioNet is the
 * source of truth for: stake custody, verdict outcomes, settlement, appeal
 * bonds. Every table here that mirrors on-chain state carries a
 * `contract_tx_hash` / `contract_case_id` linkage so it can be rebuilt from
 * the contract's event log by the indexer service (src/indexer/) at any
 * time. Never trust a cached row here for "did I get paid" — the frontend
 * reads settlement truth directly from the contract.
 */

import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums — mirror the contract's state machine and domain vocabulary exactly.
// Product language per spec: Claim / Respondent / Claimant / Case /
// Collateral / Evidence / Resolution / Verdict / Appeal / Settlement /
// Constitution / Resolution Recipe / Casebook. Never "bet"/"gamble"/"odds".
// ---------------------------------------------------------------------------

export const caseStatusEnum = pgEnum("case_status", [
  "draft",
  "open",
  "awaiting_respondent_stake",
  "funded",
  "evidence_window",
  "under_investigation",
  "verdict_rendered",
  "appeal_window",
  "appealed",
  "re_investigation",
  "final",
  "settled",
  "cancelled",
  "abandoned",
]);

export const caseVisibilityEnum = pgEnum("case_visibility", ["public", "private"]);

export const participantRoleEnum = pgEnum("participant_role", ["claimant", "respondent"]);

export const evidenceTypeEnum = pgEnum("evidence_type", [
  "url",
  "document",
  "image",
  "transaction_record",
  "text_statement",
]);

export const evidenceStatusEnum = pgEnum("evidence_status", [
  "submitted",
  "pending_review",
  "verified",
  "verification_failed",
  "disputed",
]);

// Distinguishes participant-submitted claims from contract-verified facts —
// required by the spec's evidence-security section. Never conflate the two.
export const evidenceProvenanceEnum = pgEnum("evidence_provenance", [
  "participant_submitted",
  "contract_verified",
]);

export const verdictOutcomeEnum = pgEnum("verdict_outcome", [
  "claimant_wins",
  "respondent_wins",
  "partial_claimant",
  "partial_respondent",
]);

export const verdictStageEnum = pgEnum("verdict_stage", ["initial", "appeal"]);

export const appealStatusEnum = pgEnum("appeal_status", [
  "filed",
  "bond_locked",
  "under_re_investigation",
  "resolved",
  "rejected_out_of_window",
]);

export const settlementTypeEnum = pgEnum("settlement_type", [
  "verdict_payout",
  "appeal_payout",
  "abandonment_recovery",
  "cancellation_refund",
]);

export const constitutionStatusEnum = pgEnum("constitution_status", ["draft", "active", "deprecated"]);

export const amendmentStatusEnum = pgEnum("amendment_status", ["proposed", "approved", "rejected"]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "case_stake_required",
  "case_funded",
  "evidence_submitted",
  "verdict_rendered",
  "appeal_window_opened",
  "appeal_filed",
  "case_settled",
  "case_abandoned_recoverable",
]);

export const transactionKindEnum = pgEnum("transaction_kind", [
  "stake_lock",
  "appeal_bond_lock",
  "settlement_payout",
  "abandonment_recovery",
  "cancellation_refund",
]);

export const transactionStatusEnum = pgEnum("transaction_status", [
  "pending",
  "submitted",
  "confirmed",
  "failed",
  "dropped",
]);

// ---------------------------------------------------------------------------
// Users & wallets
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    walletAddress: varchar("wallet_address", { length: 42 }).notNull(),
    displayName: varchar("display_name", { length: 80 }),
    bio: text("bio"),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => ({
    walletAddressIdx: uniqueIndex("users_wallet_address_idx").on(table.walletAddress),
  }),
);

// One-time-use SIWE-style nonces. A nonce is deleted/expired immediately
// after successful verification so it can never be replayed.
export const authNonces = pgTable(
  "auth_nonces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    walletAddress: varchar("wallet_address", { length: 42 }).notNull(),
    nonce: varchar("nonce", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    nonceIdx: uniqueIndex("auth_nonces_nonce_idx").on(table.nonce),
    walletIdx: index("auth_nonces_wallet_idx").on(table.walletAddress),
  }),
);

// ---------------------------------------------------------------------------
// Constitutions — living, versioned rule sets. A resolved case stores a hard
// reference to constitutionVersionId; amendments create a NEW version row,
// they never mutate an existing one. This guarantees historical
// reproducibility per the spec's "never retroactively change a completed
// case" requirement.
// ---------------------------------------------------------------------------

export const constitutions = pgTable("constitutions", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: varchar("slug", { length: 80 }).notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  category: varchar("category", { length: 60 }).notNull(), // delivery, freelance, refund, event, sports, community, content, dao, commerce, challenge, custom
  description: text("description"),
  status: constitutionStatusEnum("status").default("active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  slugIdx: uniqueIndex("constitutions_slug_idx").on(table.slug),
}));

export const constitutionVersions = pgTable(
  "constitution_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    constitutionId: uuid("constitution_id").notNull().references(() => constitutions.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    contractVersionRef: varchar("contract_version_ref", { length: 100 }), // on-chain constitution version identifier once published
    changeSummary: text("change_summary"),
    isCurrent: boolean("is_current").default(false).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow().notNull(),
    casesResolvedCount: integer("cases_resolved_count").default(0).notNull(),
    appealsCount: integer("appeals_count").default(0).notNull(),
    overturnsCount: integer("overturns_count").default(0).notNull(),
  },
  (table) => ({
    constitutionVersionIdx: uniqueIndex("constitution_versions_unique_idx").on(
      table.constitutionId,
      table.versionNumber,
    ),
  }),
);

// Immutable fundamental articles (e.g. "Evidence must be independently
// verifiable") that apply platform-wide, layered under each constitution
// version's case-specific rules.
export const constitutionArticles = pgTable("constitution_articles", {
  id: uuid("id").defaultRandom().primaryKey(),
  constitutionVersionId: uuid("constitution_version_id")
    .notNull()
    .references(() => constitutionVersions.id, { onDelete: "restrict" }),
  articleNumber: integer("article_number").notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  body: text("body").notNull(),
  isImmutableCore: boolean("is_immutable_core").default(false).notNull(),
  displayOrder: integer("display_order").default(0).notNull(),
});

export const constitutionAmendments = pgTable("constitution_amendments", {
  id: uuid("id").defaultRandom().primaryKey(),
  constitutionId: uuid("constitution_id").notNull().references(() => constitutions.id, { onDelete: "restrict" }),
  fromVersionId: uuid("from_version_id").references(() => constitutionVersions.id),
  toVersionId: uuid("to_version_id").references(() => constitutionVersions.id),
  proposedByUserId: uuid("proposed_by_user_id").references(() => users.id),
  rationale: text("rationale").notNull(),
  status: amendmentStatusEnum("status").default("proposed").notNull(),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Reusable resolution templates so users don't write a constitution from
// scratch for common categories (Delivery, Freelance, Refund, Event, ...).
export const resolutionRecipes = pgTable("resolution_recipes", {
  id: uuid("id").defaultRandom().primaryKey(),
  constitutionId: uuid("constitution_id").notNull().references(() => constitutions.id, { onDelete: "restrict" }),
  name: varchar("name", { length: 120 }).notNull(),
  category: varchar("category", { length: 60 }).notNull(),
  description: text("description"),
  defaultCaseRules: jsonb("default_case_rules").$type<string[]>().default([]).notNull(),
  usageCount: integer("usage_count").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Cases — the central entity. contractCaseId links to the on-chain case
// once created there; everything financial reads through to the contract.
// ---------------------------------------------------------------------------

export const cases = pgTable(
  "cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contractCaseId: varchar("contract_case_id", { length: 100 }), // set once created on-chain; null while still draft
    caseNumber: varchar("case_number", { length: 20 }).notNull(), // human-facing e.g. "VX-1842"
    title: varchar("title", { length: 200 }).notNull(),
    claimText: text("claim_text").notNull(),
    resolutionRule: text("resolution_rule").notNull(), // "The claim is TRUE if ..."
    category: varchar("category", { length: 60 }).notNull(),
    status: caseStatusEnum("status").default("draft").notNull(),
    visibility: caseVisibilityEnum("visibility").default("public").notNull(),

    constitutionVersionId: uuid("constitution_version_id")
      .notNull()
      .references(() => constitutionVersions.id, { onDelete: "restrict" }),
    caseRules: jsonb("case_rules").$type<string[]>().default([]).notNull(),

    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    // The contract's create_case requires a respondent_address at creation
    // time — VERDICT has no "open to anyone" respondent concept, the
    // claimant names who they're disputing with. Stored here (not only via
    // case_participants) because the respondent may not have signed in yet
    // when the case is created. Nullable at the DB level only to avoid
    // breaking pre-existing draft rows created before this field existed —
    // the API requires it on every new case (see routes/cases.ts).
    respondentAddress: varchar("respondent_address", { length: 42 }),

    stakeAmountWei: numeric("stake_amount_wei", { precision: 78, scale: 0 }).notNull(),
    appealBondAmountWei: numeric("appeal_bond_amount_wei", { precision: 78, scale: 0 }).notNull(),

    evidenceWindowHours: integer("evidence_window_hours").default(72).notNull(),
    appealWindowHours: integer("appeal_window_hours").default(168).notNull(), // 7 days, confirmed default

    evidenceWindowClosesAt: timestamp("evidence_window_closes_at", { withTimezone: true }),
    appealWindowClosesAt: timestamp("appeal_window_closes_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => ({
    caseNumberIdx: uniqueIndex("cases_case_number_idx").on(table.caseNumber),
    contractCaseIdIdx: uniqueIndex("cases_contract_case_id_idx").on(table.contractCaseId),
    statusIdx: index("cases_status_idx").on(table.status),
    visibilityIdx: index("cases_visibility_idx").on(table.visibility),
    categoryIdx: index("cases_category_idx").on(table.category),
  }),
);

export const caseParticipants = pgTable(
  "case_participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: participantRoleEnum("role").notNull(),
    stakeLockedAt: timestamp("stake_locked_at", { withTimezone: true }),
    stakeTxHash: varchar("stake_tx_hash", { length: 100 }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    caseRoleIdx: uniqueIndex("case_participants_case_role_idx").on(table.caseId, table.role),
    userIdx: index("case_participants_user_idx").on(table.userId),
  }),
);

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    submittedByUserId: uuid("submitted_by_user_id").notNull().references(() => users.id),
    contractEvidenceId: varchar("contract_evidence_id", { length: 100 }), // on-chain evidence ID once committed

    evidenceType: evidenceTypeEnum("evidence_type").notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description"),

    // Off-chain content location. Exactly one of these should be populated
    // depending on evidenceType.
    sourceUrl: text("source_url"),
    fileStoragePath: text("file_storage_path"), // path on the Fly.io volume
    fileMimeType: varchar("file_mime_type", { length: 100 }),
    fileSizeBytes: integer("file_size_bytes"),
    textContent: text("text_content"),

    // Tamper-evidence: SHA-256 of the content at submission time, committed
    // on-chain. A verdict-time re-fetch/re-hash mismatch is flagged, not
    // silently accepted — see contracts/verdict_contract.py evidence
    // verification logic.
    contentHashSha256: varchar("content_hash_sha256", { length: 64 }).notNull(),

    status: evidenceStatusEnum("status").default("submitted").notNull(),
    provenance: evidenceProvenanceEnum("provenance").default("participant_submitted").notNull(),

    isAppealEvidence: boolean("is_appeal_evidence").default(false).notNull(),

    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    caseIdx: index("evidence_case_idx").on(table.caseId),
    contractEvidenceIdIdx: uniqueIndex("evidence_contract_evidence_id_idx").on(table.contractEvidenceId),
    hashIdx: index("evidence_content_hash_idx").on(table.contentHashSha256),
  }),
);

// Records of the contract independently re-verifying evidence (e.g. a
// verdict-time web-fetch of a submitted URL). This is what makes
// "independently verified" auditable rather than just claimed.
export const evidenceReviews = pgTable("evidence_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  evidenceId: uuid("evidence_id").notNull().references(() => evidence.id, { onDelete: "cascade" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).defaultNow().notNull(),
  reFetchSucceeded: boolean("re_fetch_succeeded").notNull(),
  contentHashMatchedAtReview: boolean("content_hash_matched_at_review"),
  reviewNotes: text("review_notes"), // structured summary from the contract's nondet evaluation, never raw untrusted prose treated as fact
  contractTxHash: varchar("contract_tx_hash", { length: 100 }),
});

// ---------------------------------------------------------------------------
// Stakes, verdicts, appeals, settlements — all mirror on-chain events.
// ---------------------------------------------------------------------------

export const stakes = pgTable("stakes", {
  id: uuid("id").defaultRandom().primaryKey(),
  caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  participantId: uuid("participant_id").notNull().references(() => caseParticipants.id, { onDelete: "cascade" }),
  amountWei: numeric("amount_wei", { precision: 78, scale: 0 }).notNull(),
  txHash: varchar("tx_hash", { length: 100 }).notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }).defaultNow().notNull(),
});

export const verdicts = pgTable(
  "verdicts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    stage: verdictStageEnum("stage").notNull(), // initial | appeal
    outcome: verdictOutcomeEnum("outcome").notNull(),
    payoutBpsToClaimant: integer("payout_bps_to_claimant"), // basis points, only set on partial outcomes
    reasoningSummary: text("reasoning_summary").notNull(), // structured LLM output, not raw untrusted evidence text
    evidenceConsideredIds: jsonb("evidence_considered_ids").$type<string[]>().default([]).notNull(),
    contractTxHash: varchar("contract_tx_hash", { length: 100 }).notNull(),
    renderedAt: timestamp("rendered_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    caseStageIdx: uniqueIndex("verdicts_case_stage_idx").on(table.caseId, table.stage),
  }),
);

export const appeals = pgTable("appeals", {
  id: uuid("id").defaultRandom().primaryKey(),
  caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  filedByUserId: uuid("filed_by_user_id").notNull().references(() => users.id),
  status: appealStatusEnum("status").default("filed").notNull(),
  bondAmountWei: numeric("bond_amount_wei", { precision: 78, scale: 0 }).notNull(),
  bondTxHash: varchar("bond_tx_hash", { length: 100 }),
  reason: text("reason").notNull(),
  filedAt: timestamp("filed_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const settlements = pgTable("settlements", {
  id: uuid("id").defaultRandom().primaryKey(),
  caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  settlementType: settlementTypeEnum("settlement_type").notNull(),
  recipientUserId: uuid("recipient_user_id").notNull().references(() => users.id),
  amountWei: numeric("amount_wei", { precision: 78, scale: 0 }).notNull(),
  contractTxHash: varchar("contract_tx_hash", { length: 100 }).notNull(),
  settledAt: timestamp("settled_at", { withTimezone: true }).defaultNow().notNull(),
});

// Generic on-chain transaction tracker backing the frontend's transaction
// lifecycle UI (idle -> wallet-confirm -> submitted -> pending -> confirmed
// / failed). Never collapse this into a bare "success" boolean.
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    kind: transactionKindEnum("kind").notNull(),
    status: transactionStatusEnum("status").default("pending").notNull(),
    txHash: varchar("tx_hash", { length: 100 }),
    amountWei: numeric("amount_wei", { precision: 78, scale: 0 }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (table) => ({
    userIdx: index("transactions_user_idx").on(table.userId),
    txHashIdx: index("transactions_tx_hash_idx").on(table.txHash),
  }),
);

// ---------------------------------------------------------------------------
// Notifications & audit log
// ---------------------------------------------------------------------------

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    message: text("message").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userUnreadIdx: index("notifications_user_unread_idx").on(table.userId, table.readAt),
  }),
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    action: varchar("action", { length: 100 }).notNull(),
    detail: jsonb("detail"),
    ipAddress: varchar("ip_address", { length: 45 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    caseIdx: index("audit_logs_case_idx").on(table.caseId),
    actorIdx: index("audit_logs_actor_idx").on(table.actorUserId),
  }),
);

// ---------------------------------------------------------------------------
// Relations (for Drizzle's relational query API)
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  caseParticipations: many(caseParticipants),
  submittedEvidence: many(evidence),
  notifications: many(notifications),
}));

export const casesRelations = relations(cases, ({ one, many }) => ({
  constitutionVersion: one(constitutionVersions, {
    fields: [cases.constitutionVersionId],
    references: [constitutionVersions.id],
  }),
  createdBy: one(users, { fields: [cases.createdByUserId], references: [users.id] }),
  participants: many(caseParticipants),
  evidence: many(evidence),
  verdicts: many(verdicts),
  appeals: many(appeals),
  settlements: many(settlements),
}));

export const caseParticipantsRelations = relations(caseParticipants, ({ one, many }) => ({
  case: one(cases, { fields: [caseParticipants.caseId], references: [cases.id] }),
  user: one(users, { fields: [caseParticipants.userId], references: [users.id] }),
  stakes: many(stakes),
}));

export const evidenceRelations = relations(evidence, ({ one, many }) => ({
  case: one(cases, { fields: [evidence.caseId], references: [cases.id] }),
  submittedBy: one(users, { fields: [evidence.submittedByUserId], references: [users.id] }),
  reviews: many(evidenceReviews),
}));

export const constitutionsRelations = relations(constitutions, ({ many }) => ({
  versions: many(constitutionVersions),
  amendments: many(constitutionAmendments),
  recipes: many(resolutionRecipes),
}));

export const constitutionVersionsRelations = relations(constitutionVersions, ({ one, many }) => ({
  constitution: one(constitutions, {
    fields: [constitutionVersions.constitutionId],
    references: [constitutions.id],
  }),
  articles: many(constitutionArticles),
  cases: many(cases),
}));
