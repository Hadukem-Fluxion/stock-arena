CREATE TABLE "reward_control" (
	"id" integer PRIMARY KEY NOT NULL,
	CONSTRAINT "reward_control_singleton" CHECK ("reward_control"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "reward_destination_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"old_values" jsonb NOT NULL,
	"new_values" jsonb NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "reward_history_actor" CHECK ("reward_destination_history"."actor" IN ('player','staff'))
);
--> statement-breakpoint
CREATE TABLE "reward_destinations" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"bybit_uid" text DEFAULT '' NOT NULL,
	"mantle_address" text DEFAULT '' NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"points" bigint NOT NULL,
	"display_name" text NOT NULL,
	"identities" jsonb NOT NULL,
	"eligibility" text DEFAULT 'review_required' NOT NULL,
	"prize_description" text NOT NULL,
	CONSTRAINT "reward_entry_rank" UNIQUE("season_id","rank"),
	CONSTRAINT "reward_entry_user" UNIQUE("season_id","user_id"),
	CONSTRAINT "reward_entry_positive_rank" CHECK ("reward_entries"."rank" > 0)
);
--> statement-breakpoint
CREATE TABLE "reward_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"note" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "reward_event_version" UNIQUE("entry_id","version"),
	CONSTRAINT "reward_event_status" CHECK ("reward_events"."status" IN ('pending','approved','delivered','void')),
	CONSTRAINT "reward_event_version_positive" CHECK ("reward_events"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reward_locks" (
	"season_id" text PRIMARY KEY NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_prizes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" text NOT NULL,
	"rank_from" integer NOT NULL,
	"rank_to" integer NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "reward_prize_ranks" CHECK ("reward_prizes"."rank_from" > 0 AND "reward_prizes"."rank_to" >= "reward_prizes"."rank_from")
);
--> statement-breakpoint
CREATE TABLE "reward_snapshots" (
	"season_id" text PRIMARY KEY NOT NULL,
	"season_name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"top_n" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "reward_snapshot_top" CHECK ("reward_snapshots"."top_n" > 0)
);
--> statement-breakpoint
ALTER TABLE "reward_destination_history" ADD CONSTRAINT "reward_destination_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_destination_history" ADD CONSTRAINT "reward_destination_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_destinations" ADD CONSTRAINT "reward_destinations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_entries" ADD CONSTRAINT "reward_entries_season_id_reward_snapshots_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."reward_snapshots"("season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_entries" ADD CONSTRAINT "reward_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_events" ADD CONSTRAINT "reward_events_entry_id_reward_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."reward_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_events" ADD CONSTRAINT "reward_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_locks" ADD CONSTRAINT "reward_locks_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_prizes" ADD CONSTRAINT "reward_prizes_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_snapshots" ADD CONSTRAINT "reward_snapshots_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_snapshots" ADD CONSTRAINT "reward_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reward_history_user_idx" ON "reward_destination_history" USING btree ("user_id","changed_at");--> statement-breakpoint
INSERT INTO reward_control (id) VALUES (1);
--> statement-breakpoint
CREATE FUNCTION reject_reward_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Reward records are append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER immutable_reward_history BEFORE UPDATE OR DELETE OR TRUNCATE ON reward_destination_history FOR EACH STATEMENT EXECUTE FUNCTION reject_reward_mutation();
--> statement-breakpoint
CREATE TRIGGER immutable_reward_prizes BEFORE UPDATE OR DELETE OR TRUNCATE ON reward_prizes FOR EACH STATEMENT EXECUTE FUNCTION reject_reward_mutation();
--> statement-breakpoint
CREATE TRIGGER immutable_reward_snapshots BEFORE UPDATE OR DELETE OR TRUNCATE ON reward_snapshots FOR EACH STATEMENT EXECUTE FUNCTION reject_reward_mutation();
--> statement-breakpoint
CREATE TRIGGER immutable_reward_entries BEFORE UPDATE OR DELETE OR TRUNCATE ON reward_entries FOR EACH STATEMENT EXECUTE FUNCTION reject_reward_mutation();
--> statement-breakpoint
CREATE TRIGGER immutable_reward_events BEFORE UPDATE OR DELETE OR TRUNCATE ON reward_events FOR EACH STATEMENT EXECUTE FUNCTION reject_reward_mutation();
