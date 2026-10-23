CREATE TABLE "game_controls" (
	"game" text PRIMARY KEY NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_controls_game" CHECK ("game_controls"."game" IN ('checkin', 'quiz', 'higher_lower'))
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	CONSTRAINT "seasons_start_unique" UNIQUE("starts_at"),
	CONSTRAINT "seasons_dates" CHECK ("seasons"."ends_at" IS NULL OR "seasons"."ends_at" > "seasons"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "ticker_controls" (
	"ticker" text PRIMARY KEY NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticker_status" ADD COLUMN "oracle_state" "ticker_state";--> statement-breakpoint
ALTER TABLE "ticker_status" ADD COLUMN "oracle_reason" text;--> statement-breakpoint
INSERT INTO game_controls (game) VALUES ('checkin'), ('quiz'), ('higher_lower');
--> statement-breakpoint
INSERT INTO seasons (id, name, starts_at, ends_at) VALUES ('season-1', 'Season 1', '2026-10-16T00:00:00Z', NULL);
--> statement-breakpoint
ALTER TABLE seasons ADD CONSTRAINT seasons_no_overlap EXCLUDE USING gist (tstzrange(starts_at, ends_at, '[)') WITH &&);
--> statement-breakpoint
INSERT INTO ticker_controls (ticker, paused, reason)
SELECT ticker, true, 'Existing manual pause' FROM ticker_status WHERE state = 'paused' AND reason = 'manual';
--> statement-breakpoint
UPDATE ticker_status SET oracle_state = CASE WHEN reason = 'manual' THEN 'paused'::ticker_state ELSE state END,
  oracle_reason = CASE WHEN reason = 'manual' THEN 'stale' ELSE reason END;
