CREATE TABLE "extended_price_references" (
	"ticker" text NOT NULL,
	"price_usd" numeric NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	CONSTRAINT "extended_price_references_ticker_taken_at_pk" PRIMARY KEY("ticker","taken_at"),
	CONSTRAINT "extended_reference_price" CHECK ("extended_price_references"."price_usd">0)
);
--> statement-breakpoint
CREATE TABLE "extended_quotes" (
	"ticker" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"price_usd" numeric NOT NULL,
	"reference_price" numeric,
	"reference_at" timestamp with time zone,
	"change_24h_pct" numeric,
	"taken_at" timestamp with time zone NOT NULL,
	"last_session" boolean DEFAULT false NOT NULL,
	"halted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "extended_positive_prices" CHECK ("extended_quotes"."price_usd">0 AND ("extended_quotes"."reference_price" IS NULL OR "extended_quotes"."reference_price">0)),
	CONSTRAINT "extended_reference_pair" CHECK (("extended_quotes"."reference_price" IS NULL)=("extended_quotes"."change_24h_pct" IS NULL) AND ("extended_quotes"."reference_price" IS NULL)=("extended_quotes"."reference_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "flyer_daily_courses" (
	"day" date PRIMARY KEY NOT NULL,
	"course" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "flyer_daily_v2" CHECK ("flyer_daily_courses"."course"->>'version'='flyer-2' AND "flyer_daily_courses"."course"->>'day'="flyer_daily_courses"."day"::text)
);
--> statement-breakpoint
ALTER TABLE "flyer_sessions" ADD COLUMN "daily_course_day" date;--> statement-breakpoint
CREATE INDEX "extended_references_time_idx" ON "extended_price_references" USING btree ("taken_at");--> statement-breakpoint
ALTER TABLE "flyer_sessions" ADD CONSTRAINT "flyer_sessions_daily_course_day_flyer_daily_courses_day_fk" FOREIGN KEY ("daily_course_day") REFERENCES "public"."flyer_daily_courses"("day") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER protect_flyer_daily_reference BEFORE UPDATE OF daily_course_day ON flyer_sessions
FOR EACH ROW WHEN (OLD.daily_course_day IS DISTINCT FROM NEW.daily_course_day)
EXECUTE FUNCTION reject_reward_mutation();
--> statement-breakpoint
CREATE TRIGGER protect_flyer_daily_course BEFORE UPDATE OR DELETE ON flyer_daily_courses
FOR EACH ROW EXECUTE FUNCTION reject_reward_mutation();
--> statement-breakpoint
CREATE TRIGGER protect_flyer_daily_course_truncate BEFORE TRUNCATE ON flyer_daily_courses
FOR EACH STATEMENT EXECUTE FUNCTION reject_reward_mutation();
