CREATE TABLE "quiz_daily_sets" (
	"day" date PRIMARY KEY NOT NULL,
	"questions" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD COLUMN "explanation" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_slug_unique" UNIQUE("slug");