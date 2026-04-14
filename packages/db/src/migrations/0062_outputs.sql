CREATE TABLE IF NOT EXISTS "outputs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'pending_approval',
  "draft_content" text NOT NULL DEFAULT '',
  "proposed_by_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "approved_by_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "approval_issue_id" uuid REFERENCES "issues"("id") ON DELETE SET NULL,
  "latest_version_number" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "output_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "output_id" uuid NOT NULL REFERENCES "outputs"("id") ON DELETE CASCADE,
  "version_number" integer NOT NULL,
  "content" text NOT NULL,
  "released_by_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "release_notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outputs_company_idx" ON "outputs" ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "output_versions_output_idx" ON "output_versions" ("output_id");
