CREATE TABLE "flag_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flag_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_bank_control" (
	"id" integer PRIMARY KEY NOT NULL,
	CONSTRAINT "quiz_bank_control_singleton" CHECK ("quiz_bank_control"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "flag_notes" ADD CONSTRAINT "flag_notes_flag_id_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."flags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flag_notes" ADD CONSTRAINT "flag_notes_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flag_notes_flag_idx" ON "flag_notes" USING btree ("flag_id","created_at");--> statement-breakpoint
INSERT INTO "quiz_bank_control" ("id") VALUES (1);
--> statement-breakpoint
CREATE FUNCTION reject_flag_note_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'flag_notes is append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER immutable_flag_notes
BEFORE UPDATE OR DELETE OR TRUNCATE ON "flag_notes"
FOR EACH STATEMENT EXECUTE FUNCTION reject_flag_note_mutation();
