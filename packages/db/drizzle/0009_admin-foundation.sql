CREATE TYPE "public"."staff_role" AS ENUM('owner', 'admin', 'moderator', 'support');--> statement-breakpoint
CREATE TABLE "admin_control" (
	"id" integer PRIMARY KEY NOT NULL,
	"bootstrapped_at" timestamp with time zone,
	CONSTRAINT "admin_control_singleton" CHECK ("admin_control"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "admin_oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"browser_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"role" "staff_role" NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "admin_actions" ALTER COLUMN "target_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_actions" ADD COLUMN "target_type" text;--> statement-breakpoint
ALTER TABLE "admin_actions" ADD COLUMN "target_id" text;--> statement-breakpoint
ALTER TABLE "admin_actions" ADD COLUMN "details" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_actions" ADD COLUMN "ip_hash" text;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_sessions_user_idx" ON "admin_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_actions_created_idx" ON "admin_actions" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "admin_actions_actor_idx" ON "admin_actions" USING btree ("admin_id","created_at");
--> statement-breakpoint
INSERT INTO "admin_control" ("id") VALUES (1);
--> statement-breakpoint
CREATE FUNCTION reject_admin_action_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_actions is append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER immutable_admin_actions
BEFORE UPDATE OR DELETE OR TRUNCATE ON "admin_actions"
FOR EACH STATEMENT EXECUTE FUNCTION reject_admin_action_mutation();
