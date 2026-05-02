-- Pillar 1 of the Quality Flywheel: continuous scoring of heartbeat runs.
-- Every successful run gets auto-judged when `autoScoreRuns` is enabled, and
-- the score is stored here. Powers per-agent quality trends and drift alerts.
CREATE TABLE "run_scores" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "heartbeat_runs"("id") ON DELETE CASCADE,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "score" real NOT NULL,
  "rubric_version" text NOT NULL DEFAULT 'generic-v1',
  "rubric_source" text NOT NULL DEFAULT 'generic',
  "reasoning" text,
  "judge_model" text,
  "judged_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "run_scores_run_idx" ON "run_scores" ("run_id");
CREATE INDEX "run_scores_agent_judged_idx" ON "run_scores" ("agent_id", "judged_at");
CREATE INDEX "run_scores_company_judged_idx" ON "run_scores" ("company_id", "judged_at");
