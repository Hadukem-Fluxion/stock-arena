CREATE TYPE "public"."flag_state" AS ENUM('open', 'cleared', 'actioned');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('discord', 'telegram');--> statement-breakpoint
CREATE TYPE "public"."ticker_state" AS ENUM('live', 'paused');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'banned');--> statement-breakpoint
CREATE TABLE "admin_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkins" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"streak" integer NOT NULL,
	CONSTRAINT "checkins_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"raised_by" uuid NOT NULL,
	"note" text NOT NULL,
	"state" "flag_state" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hl_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"run_number" integer NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "hl_runs_user_day_run_unique" UNIQUE("user_id","day","run_number"),
	CONSTRAINT "hl_runs_run_number" CHECK ("hl_runs"."run_number" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"user_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"platform_user_id" text NOT NULL,
	"platform_created_at" timestamp with time zone,
	CONSTRAINT "identities_platform_platform_user_id_pk" PRIMARY KEY("platform","platform_user_id")
);
--> statement-breakpoint
CREATE TABLE "points_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"ref_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_ledger_user_reason_ref_unique" UNIQUE("user_id","reason","ref_id")
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"ticker" text NOT NULL,
	"price_usd" numeric NOT NULL,
	"block_number" bigint NOT NULL,
	"taken_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_attempts" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"question_ids" uuid[] NOT NULL,
	"answers" integer[] NOT NULL,
	"started_at" timestamp with time zone[] NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "quiz_attempts_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "quiz_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb NOT NULL,
	"answer_index" integer NOT NULL,
	"topic" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"scheduled_day" date,
	CONSTRAINT "quiz_questions_four_options" CHECK (CASE WHEN jsonb_typeof("quiz_questions"."options") = 'array' THEN jsonb_array_length("quiz_questions"."options") = 4 ELSE false END),
	CONSTRAINT "quiz_questions_answer_index" CHECK ("quiz_questions"."answer_index" BETWEEN 0 AND 3)
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"inviter_id" uuid NOT NULL,
	"invitee_id" uuid PRIMARY KEY NOT NULL,
	"qualified_at" timestamp with time zone,
	CONSTRAINT "referrals_no_self_invite" CHECK ("referrals"."inviter_id" <> "referrals"."invitee_id")
);
--> statement-breakpoint
CREATE TABLE "ticker_status" (
	"ticker" text PRIMARY KEY NOT NULL,
	"state" "ticker_state" NOT NULL,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hl_runs" ADD CONSTRAINT "hl_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_invitee_id_users_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "points_ledger_user_created_at_idx" ON "points_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "points_ledger_created_at_idx" ON "points_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "price_snapshots_ticker_taken_at_idx" ON "price_snapshots" USING btree ("ticker","taken_at");