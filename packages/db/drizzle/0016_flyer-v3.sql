CREATE TABLE "flyer_v3_daily_courses" (
	"day" date PRIMARY KEY NOT NULL,
	"course" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "flyer_daily_v3" CHECK ("flyer_v3_daily_courses"."course"->>'version'='flyer-3' AND "flyer_v3_daily_courses"."course"->>'day'="flyer_v3_daily_courses"."day"::text)
);
--> statement-breakpoint
CREATE TABLE "flyer_v3_results" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"pipes" integer NOT NULL,
	"coins" integer NOT NULL,
	"end_reason" text NOT NULL,
	CONSTRAINT "flyer_v3_counts" CHECK ("flyer_v3_results"."pipes">=0 AND "flyer_v3_results"."coins">=0),
	CONSTRAINT "flyer_v3_end_reason" CHECK ("flyer_v3_results"."end_reason" IN ('collision','retired','limit'))
);
--> statement-breakpoint
ALTER TABLE "flyer_v3_results" ADD CONSTRAINT "flyer_v3_results_session_id_flyer_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."flyer_sessions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER protect_flyer_v3_daily BEFORE UPDATE OR DELETE ON flyer_v3_daily_courses
FOR EACH ROW EXECUTE FUNCTION reject_reward_mutation();
--> statement-breakpoint
CREATE TRIGGER protect_flyer_v3_daily_truncate BEFORE TRUNCATE ON flyer_v3_daily_courses
FOR EACH STATEMENT EXECUTE FUNCTION reject_reward_mutation();
--> statement-breakpoint
CREATE TRIGGER protect_flyer_v3_results BEFORE UPDATE OR DELETE ON flyer_v3_results
FOR EACH ROW EXECUTE FUNCTION reject_reward_mutation();
--> statement-breakpoint
CREATE TRIGGER protect_flyer_v3_results_truncate BEFORE TRUNCATE ON flyer_v3_results
FOR EACH STATEMENT EXECUTE FUNCTION reject_reward_mutation();
