DO $$ BEGIN
 CREATE TYPE "public"."amendment_status" AS ENUM('proposed', 'approved', 'rejected');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."appeal_status" AS ENUM('filed', 'bond_locked', 'under_re_investigation', 'resolved', 'rejected_out_of_window');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."case_status" AS ENUM('draft', 'open', 'awaiting_respondent_stake', 'funded', 'evidence_window', 'under_investigation', 'verdict_rendered', 'appeal_window', 'appealed', 're_investigation', 'final', 'settled', 'cancelled', 'abandoned');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."case_visibility" AS ENUM('public', 'private');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."constitution_status" AS ENUM('draft', 'active', 'deprecated');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."evidence_provenance" AS ENUM('participant_submitted', 'contract_verified');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."evidence_status" AS ENUM('submitted', 'pending_review', 'verified', 'verification_failed', 'disputed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."evidence_type" AS ENUM('url', 'document', 'image', 'transaction_record', 'text_statement');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."notification_type" AS ENUM('case_stake_required', 'case_funded', 'evidence_submitted', 'verdict_rendered', 'appeal_window_opened', 'appeal_filed', 'case_settled', 'case_abandoned_recoverable');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."participant_role" AS ENUM('claimant', 'respondent');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."settlement_type" AS ENUM('verdict_payout', 'appeal_payout', 'abandonment_recovery', 'cancellation_refund');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."transaction_kind" AS ENUM('stake_lock', 'appeal_bond_lock', 'settlement_payout', 'abandonment_recovery', 'cancellation_refund');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'submitted', 'confirmed', 'failed', 'dropped');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."verdict_outcome" AS ENUM('claimant_wins', 'respondent_wins', 'partial_claimant', 'partial_respondent');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."verdict_stage" AS ENUM('initial', 'appeal');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"filed_by_user_id" uuid NOT NULL,
	"status" "appeal_status" DEFAULT 'filed' NOT NULL,
	"bond_amount_wei" numeric(78, 0) NOT NULL,
	"bond_tx_hash" varchar(100),
	"reason" text NOT NULL,
	"filed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"case_id" uuid,
	"action" varchar(100) NOT NULL,
	"detail" jsonb,
	"ip_address" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_nonces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" varchar(42) NOT NULL,
	"nonce" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "case_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "participant_role" NOT NULL,
	"stake_locked_at" timestamp with time zone,
	"stake_tx_hash" varchar(100),
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_case_id" varchar(100),
	"case_number" varchar(20) NOT NULL,
	"title" varchar(200) NOT NULL,
	"claim_text" text NOT NULL,
	"resolution_rule" text NOT NULL,
	"category" varchar(60) NOT NULL,
	"status" "case_status" DEFAULT 'draft' NOT NULL,
	"visibility" "case_visibility" DEFAULT 'public' NOT NULL,
	"constitution_version_id" uuid NOT NULL,
	"case_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"stake_amount_wei" numeric(78, 0) NOT NULL,
	"appeal_bond_amount_wei" numeric(78, 0) NOT NULL,
	"evidence_window_hours" integer DEFAULT 72 NOT NULL,
	"appeal_window_hours" integer DEFAULT 168 NOT NULL,
	"evidence_window_closes_at" timestamp with time zone,
	"appeal_window_closes_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "constitution_amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constitution_id" uuid NOT NULL,
	"from_version_id" uuid,
	"to_version_id" uuid,
	"proposed_by_user_id" uuid,
	"rationale" text NOT NULL,
	"status" "amendment_status" DEFAULT 'proposed' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "constitution_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constitution_version_id" uuid NOT NULL,
	"article_number" integer NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"is_immutable_core" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "constitution_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constitution_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"contract_version_ref" varchar(100),
	"change_summary" text,
	"is_current" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cases_resolved_count" integer DEFAULT 0 NOT NULL,
	"appeals_count" integer DEFAULT 0 NOT NULL,
	"overturns_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "constitutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(80) NOT NULL,
	"title" varchar(160) NOT NULL,
	"category" varchar(60) NOT NULL,
	"description" text,
	"status" "constitution_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"contract_evidence_id" varchar(100),
	"evidence_type" "evidence_type" NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"source_url" text,
	"file_storage_path" text,
	"file_mime_type" varchar(100),
	"file_size_bytes" integer,
	"text_content" text,
	"content_hash_sha256" varchar(64) NOT NULL,
	"status" "evidence_status" DEFAULT 'submitted' NOT NULL,
	"provenance" "evidence_provenance" DEFAULT 'participant_submitted' NOT NULL,
	"is_appeal_evidence" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evidence_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_id" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"re_fetch_succeeded" boolean NOT NULL,
	"content_hash_matched_at_review" boolean,
	"review_notes" text,
	"contract_tx_hash" varchar(100)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"case_id" uuid,
	"type" "notification_type" NOT NULL,
	"message" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resolution_recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constitution_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"category" varchar(60) NOT NULL,
	"description" text,
	"default_case_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"settlement_type" "settlement_type" NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"amount_wei" numeric(78, 0) NOT NULL,
	"contract_tx_hash" varchar(100) NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"amount_wei" numeric(78, 0) NOT NULL,
	"tx_hash" varchar(100) NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"case_id" uuid,
	"kind" "transaction_kind" NOT NULL,
	"status" "transaction_status" DEFAULT 'pending' NOT NULL,
	"tx_hash" varchar(100),
	"amount_wei" numeric(78, 0),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" varchar(42) NOT NULL,
	"display_name" varchar(80),
	"bio" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verdicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"stage" "verdict_stage" NOT NULL,
	"outcome" "verdict_outcome" NOT NULL,
	"payout_bps_to_claimant" integer,
	"reasoning_summary" text NOT NULL,
	"evidence_considered_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contract_tx_hash" varchar(100) NOT NULL,
	"rendered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appeals" ADD CONSTRAINT "appeals_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appeals" ADD CONSTRAINT "appeals_filed_by_user_id_users_id_fk" FOREIGN KEY ("filed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_participants" ADD CONSTRAINT "case_participants_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_participants" ADD CONSTRAINT "case_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cases" ADD CONSTRAINT "cases_constitution_version_id_constitution_versions_id_fk" FOREIGN KEY ("constitution_version_id") REFERENCES "public"."constitution_versions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cases" ADD CONSTRAINT "cases_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "constitution_amendments" ADD CONSTRAINT "constitution_amendments_constitution_id_constitutions_id_fk" FOREIGN KEY ("constitution_id") REFERENCES "public"."constitutions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "constitution_amendments" ADD CONSTRAINT "constitution_amendments_from_version_id_constitution_versions_id_fk" FOREIGN KEY ("from_version_id") REFERENCES "public"."constitution_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "constitution_amendments" ADD CONSTRAINT "constitution_amendments_to_version_id_constitution_versions_id_fk" FOREIGN KEY ("to_version_id") REFERENCES "public"."constitution_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "constitution_amendments" ADD CONSTRAINT "constitution_amendments_proposed_by_user_id_users_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "constitution_amendments" ADD CONSTRAINT "constitution_amendments_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "constitution_articles" ADD CONSTRAINT "constitution_articles_constitution_version_id_constitution_versions_id_fk" FOREIGN KEY ("constitution_version_id") REFERENCES "public"."constitution_versions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "constitution_versions" ADD CONSTRAINT "constitution_versions_constitution_id_constitutions_id_fk" FOREIGN KEY ("constitution_id") REFERENCES "public"."constitutions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evidence" ADD CONSTRAINT "evidence_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evidence" ADD CONSTRAINT "evidence_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evidence_reviews" ADD CONSTRAINT "evidence_reviews_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resolution_recipes" ADD CONSTRAINT "resolution_recipes_constitution_id_constitutions_id_fk" FOREIGN KEY ("constitution_id") REFERENCES "public"."constitutions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settlements" ADD CONSTRAINT "settlements_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settlements" ADD CONSTRAINT "settlements_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakes" ADD CONSTRAINT "stakes_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stakes" ADD CONSTRAINT "stakes_participant_id_case_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."case_participants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_case_idx" ON "audit_logs" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_nonces_nonce_idx" ON "auth_nonces" USING btree ("nonce");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_nonces_wallet_idx" ON "auth_nonces" USING btree ("wallet_address");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "case_participants_case_role_idx" ON "case_participants" USING btree ("case_id","role");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_participants_user_idx" ON "case_participants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cases_case_number_idx" ON "cases" USING btree ("case_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cases_contract_case_id_idx" ON "cases" USING btree ("contract_case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cases_status_idx" ON "cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cases_visibility_idx" ON "cases" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cases_category_idx" ON "cases" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "constitution_versions_unique_idx" ON "constitution_versions" USING btree ("constitution_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "constitutions_slug_idx" ON "constitutions" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evidence_case_idx" ON "evidence" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "evidence_contract_evidence_id_idx" ON "evidence" USING btree ("contract_evidence_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evidence_content_hash_idx" ON "evidence" USING btree ("content_hash_sha256");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_user_idx" ON "transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_tx_hash_idx" ON "transactions" USING btree ("tx_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_wallet_address_idx" ON "users" USING btree ("wallet_address");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "verdicts_case_stage_idx" ON "verdicts" USING btree ("case_id","stage");