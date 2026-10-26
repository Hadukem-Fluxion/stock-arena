CREATE TABLE "flyer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_ticks" integer NOT NULL,
	"course" jsonb NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"finished_at" timestamp with time zone,
	"day" date,
	"score" integer,
	"ticks" integer,
	"inputs" jsonb,
	CONSTRAINT "flyer_state" CHECK ("flyer_sessions"."state" IN ('active','finished','cancelled','expired','void')),
	CONSTRAINT "flyer_score" CHECK ("flyer_sessions"."score" IS NULL OR "flyer_sessions"."score" >= 0),
	CONSTRAINT "flyer_times" CHECK ("flyer_sessions"."expires_at" > "flyer_sessions"."started_at" AND "flyer_sessions"."max_ticks" > 0),
	CONSTRAINT "flyer_result" CHECK (("flyer_sessions"."finished_at" IS NULL) = ("flyer_sessions"."score" IS NULL) AND ("flyer_sessions"."score" IS NULL) = ("flyer_sessions"."ticks" IS NULL) AND ("flyer_sessions"."score" IS NULL) = ("flyer_sessions"."inputs" IS NULL) AND ("flyer_sessions"."score" IS NULL) = ("flyer_sessions"."day" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "game_controls" DROP CONSTRAINT "game_controls_game";--> statement-breakpoint
ALTER TABLE "flyer_sessions" ADD CONSTRAINT "flyer_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "flyer_one_active_user" ON "flyer_sessions" USING btree ("user_id") WHERE "flyer_sessions"."state" = 'active';--> statement-breakpoint
CREATE INDEX "flyer_user_finished_idx" ON "flyer_sessions" USING btree ("user_id","finished_at");--> statement-breakpoint
CREATE INDEX "flyer_day_score_idx" ON "flyer_sessions" USING btree ("day","score","finished_at");--> statement-breakpoint
ALTER TABLE "game_controls" ADD CONSTRAINT "game_controls_game" CHECK ("game_controls"."game" IN ('checkin', 'quiz', 'higher_lower', 'invite', 'flyer'));--> statement-breakpoint
INSERT INTO game_controls (game) VALUES ('flyer');
--> statement-breakpoint
CREATE FUNCTION protect_flyer_session() RETURNS trigger AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Flyer sessions cannot be deleted'; END IF;
 IF (NEW.id,NEW.user_id,NEW.started_at,NEW.expires_at,NEW.max_ticks,NEW.course)
  IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.started_at,OLD.expires_at,OLD.max_ticks,OLD.course)
  OR (OLD.state <> 'active' AND (NEW.state <> 'void' OR OLD.state = 'void'))
  OR (OLD.finished_at IS NOT NULL AND (NEW.finished_at,NEW.day,NEW.score,NEW.ticks,NEW.inputs)
    IS DISTINCT FROM (OLD.finished_at,OLD.day,OLD.score,OLD.ticks,OLD.inputs))
 THEN RAISE EXCEPTION 'Frozen Flyer session cannot be changed'; END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER protect_flyer_session BEFORE UPDATE OR DELETE ON flyer_sessions
FOR EACH ROW EXECUTE FUNCTION protect_flyer_session();
--> statement-breakpoint
CREATE TRIGGER protect_flyer_truncate BEFORE TRUNCATE ON flyer_sessions
FOR EACH STATEMENT EXECUTE FUNCTION reject_reward_mutation();
