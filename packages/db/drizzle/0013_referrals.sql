CREATE TABLE "invite_codes" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	CONSTRAINT "invite_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "game_controls" DROP CONSTRAINT "game_controls_game";--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "invitee_bonus_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "platform" "platform";--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
INSERT INTO invite_codes (user_id, code)
SELECT inviter_id, 'ref_' || replace(gen_random_uuid()::text, '-', '') FROM (SELECT DISTINCT inviter_id FROM referrals) AS inviters;
--> statement-breakpoint
UPDATE referrals SET code = invite_codes.code,
 status = CASE WHEN qualified_at IS NULL THEN 'pending' ELSE 'rewarded' END
FROM invite_codes WHERE invite_codes.user_id = referrals.inviter_id;
--> statement-breakpoint
ALTER TABLE referrals ALTER COLUMN code SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_code_invite_codes_code_fk" FOREIGN KEY ("code") REFERENCES "public"."invite_codes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "referrals_inviter_idx" ON "referrals" USING btree ("inviter_id","qualified_at");--> statement-breakpoint
ALTER TABLE "game_controls" ADD CONSTRAINT "game_controls_game" CHECK ("game_controls"."game" IN ('checkin', 'quiz', 'higher_lower', 'invite'));--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_status" CHECK ("referrals"."status" IN ('pending', 'rewarded', 'void'));
--> statement-breakpoint
INSERT INTO game_controls (game) VALUES ('invite');
--> statement-breakpoint
CREATE FUNCTION protect_referral_assignment() RETURNS trigger AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Referral records cannot be deleted'; END IF;
 IF (NEW.inviter_id, NEW.invitee_id, NEW.code, NEW.platform, NEW.created_at)
   IS DISTINCT FROM (OLD.inviter_id, OLD.invitee_id, OLD.code, OLD.platform, OLD.created_at)
   OR (OLD.invitee_bonus_at IS NOT NULL AND NEW.invitee_bonus_at IS DISTINCT FROM OLD.invitee_bonus_at)
   OR OLD.status = 'void'
   OR (OLD.status = 'rewarded' AND NEW.status NOT IN ('rewarded', 'void'))
   OR (OLD.qualified_at IS NOT NULL AND NEW.qualified_at IS DISTINCT FROM OLD.qualified_at)
 THEN RAISE EXCEPTION 'Referral assignment is immutable'; END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER protect_referral BEFORE UPDATE OR DELETE ON referrals
FOR EACH ROW EXECUTE FUNCTION protect_referral_assignment();
--> statement-breakpoint
CREATE TRIGGER immutable_invite_codes BEFORE UPDATE OR DELETE OR TRUNCATE ON invite_codes
FOR EACH STATEMENT EXECUTE FUNCTION reject_reward_mutation();
--> statement-breakpoint
CREATE TRIGGER protect_referral_truncate BEFORE TRUNCATE ON referrals
FOR EACH STATEMENT EXECUTE FUNCTION reject_reward_mutation();
