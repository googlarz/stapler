ALTER TABLE "goals" ADD COLUMN "acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "target_date" date;
