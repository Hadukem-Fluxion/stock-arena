ALTER TABLE "hl_rounds" ADD COLUMN "mode" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "ticker_status" ADD COLUMN "trading_period" text;--> statement-breakpoint
ALTER TABLE "ticker_status" ADD COLUMN "trading_halted" boolean;--> statement-breakpoint
ALTER TABLE "ticker_status" ADD COLUMN "period_change_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticker_status" ADD COLUMN "last_closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hl_rounds" ADD CONSTRAINT "hl_rounds_mode" CHECK ("hl_rounds"."mode" IN ('live', 'last_session'));