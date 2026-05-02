-- Migration: 0077_skill_invocations
-- Adds the skill_invocations table that tracks every slash-command skill
-- execution in an issue thread.

CREATE TABLE IF NOT EXISTS "skill_invocations" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id"          UUID NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "issue_id"            UUID NOT NULL REFERENCES "issues"("id") ON DELETE CASCADE,
  "agent_id"            UUID REFERENCES "agents"("id") ON DELETE SET NULL,
  "skill_key"           TEXT NOT NULL,
  "args"                JSONB,
  "status"              TEXT NOT NULL DEFAULT 'pending',
  "trigger_comment_id"  UUID REFERENCES "issue_comments"("id") ON DELETE SET NULL,
  "heartbeat_run_id"    UUID REFERENCES "heartbeat_runs"("id") ON DELETE SET NULL,
  "result_comment_id"   UUID REFERENCES "issue_comments"("id") ON DELETE SET NULL,
  "error_message"       TEXT,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "skill_invocations_issue_idx"
  ON "skill_invocations" ("issue_id");

CREATE INDEX IF NOT EXISTS "skill_invocations_company_idx"
  ON "skill_invocations" ("company_id");

CREATE INDEX IF NOT EXISTS "skill_invocations_agent_idx"
  ON "skill_invocations" ("agent_id");

CREATE INDEX IF NOT EXISTS "skill_invocations_status_idx"
  ON "skill_invocations" ("status");

CREATE INDEX IF NOT EXISTS "skill_invocations_run_idx"
  ON "skill_invocations" ("heartbeat_run_id");
