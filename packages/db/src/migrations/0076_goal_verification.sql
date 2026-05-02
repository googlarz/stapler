ALTER TABLE "goals" ADD COLUMN "verification_status" text DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "verification_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "verification_issue_id" uuid;
