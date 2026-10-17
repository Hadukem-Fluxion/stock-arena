CREATE TABLE "hl_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"stocks" jsonb NOT NULL,
	"winner" text NOT NULL,
	"choice" text,
	"served_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	CONSTRAINT "hl_rounds_run_position_unique" UNIQUE("run_id","position"),
	CONSTRAINT "hl_rounds_position" CHECK ("hl_rounds"."position" BETWEEN 0 AND 9),
	CONSTRAINT "hl_rounds_pair" CHECK (jsonb_typeof("hl_rounds"."stocks") = 'array' AND jsonb_array_length("hl_rounds"."stocks") = 2 AND "hl_rounds"."stocks"->0->>'ticker' <> "hl_rounds"."stocks"->1->>'ticker'),
	CONSTRAINT "hl_rounds_winner" CHECK ("hl_rounds"."winner" IN ("hl_rounds"."stocks"->0->>'ticker', "hl_rounds"."stocks"->1->>'ticker')),
	CONSTRAINT "hl_rounds_choice" CHECK ("hl_rounds"."choice" IS NULL OR "hl_rounds"."choice" IN ("hl_rounds"."stocks"->0->>'ticker', "hl_rounds"."stocks"->1->>'ticker')),
	CONSTRAINT "hl_rounds_answer" CHECK (("hl_rounds"."choice" IS NULL) = ("hl_rounds"."answered_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "hl_rounds" ADD CONSTRAINT "hl_rounds_run_id_hl_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."hl_runs"("id") ON DELETE no action ON UPDATE no action;