CREATE TABLE "hl_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"ticker" text NOT NULL,
	"reference_ticker" text NOT NULL,
	"asset" jsonb NOT NULL,
	"offered_at" timestamp with time zone NOT NULL,
	"direction" text,
	"locked_at" timestamp with time zone,
	"scheduled_open_at" timestamp with time zone,
	"state" text DEFAULT 'offered' NOT NULL,
	"start_price" numeric,
	"start_taken_at" timestamp with time zone,
	"target_at" timestamp with time zone,
	"end_price" numeric,
	"end_taken_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	CONSTRAINT "hl_predictions_position_unique" UNIQUE("run_id","position"),
	CONSTRAINT "hl_predictions_direction" CHECK ("hl_predictions"."direction" IS NULL OR "hl_predictions"."direction" IN ('up', 'down')),
	CONSTRAINT "hl_predictions_state" CHECK ("hl_predictions"."state" IN ('offered', 'waiting_open', 'waiting_start', 'pending', 'won', 'lost', 'equal', 'void')),
	CONSTRAINT "hl_predictions_lock" CHECK (("hl_predictions"."direction" IS NULL) = ("hl_predictions"."locked_at" IS NULL)),
	CONSTRAINT "hl_predictions_start" CHECK (("hl_predictions"."start_price" IS NULL) = ("hl_predictions"."start_taken_at" IS NULL)),
	CONSTRAINT "hl_predictions_end" CHECK (("hl_predictions"."end_price" IS NULL) = ("hl_predictions"."end_taken_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ticker_halts" (
	"ticker" text NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ticker_halts_ticker_taken_at_pk" PRIMARY KEY("ticker","taken_at")
);
--> statement-breakpoint
ALTER TABLE "hl_runs" ADD COLUMN "model" text DEFAULT 'classic' NOT NULL;--> statement-breakpoint
ALTER TABLE "hl_runs" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "hl_runs" ADD COLUMN "last_settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hl_runs" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD COLUMN "tradable" boolean;--> statement-breakpoint
ALTER TABLE "ticker_status" ADD COLUMN "last_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hl_predictions" ADD CONSTRAINT "hl_predictions_run_id_hl_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."hl_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hl_predictions_pending_idx" ON "hl_predictions" USING btree ("settled_at","locked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hl_predictions_one_pending" ON "hl_predictions" USING btree ("run_id") WHERE "hl_predictions"."settled_at" IS NULL;--> statement-breakpoint
ALTER TABLE "hl_runs" ADD CONSTRAINT "hl_runs_request_unique" UNIQUE("user_id","request_id");
--> statement-breakpoint
UPDATE "hl_runs" SET "ended_at" = now() WHERE "model" = 'classic' AND "ended_at" IS NULL;
