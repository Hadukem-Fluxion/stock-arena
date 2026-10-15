CREATE TYPE "public"."price_source" AS ENUM('xstocks', 'fluxion_pool');--> statement-breakpoint
ALTER TABLE "price_snapshots" ALTER COLUMN "block_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD COLUMN "source" "price_source" DEFAULT 'fluxion_pool' NOT NULL;