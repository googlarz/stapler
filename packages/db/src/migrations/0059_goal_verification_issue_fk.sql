UPDATE "goals"
SET "verification_issue_id" = NULL
WHERE "verification_issue_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "issues"
    WHERE "issues"."id" = "goals"."verification_issue_id"
  );
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_verification_issue_id_issues_id_fk" FOREIGN KEY ("verification_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;
