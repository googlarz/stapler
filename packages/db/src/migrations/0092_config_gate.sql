-- Pillar 4 of the Quality Flywheel: config-change gate.
-- Agents can now pin a smoke eval suite. When significant config keys change
-- (systemPrompt, model, adapterType) the gate runs the suite against the
-- candidate config and blocks the update on regression.
--
-- golden_runs stores historical runs hand-curated as exemplars. They
-- auto-generate eval cases that validate the smoke suite stays green.

-- Add smoke suite link + regression tolerance to agents
ALTER TABLE "agents"
  ADD COLUMN "smoke_suite_id" uuid REFERENCES "eval_suites"("id") ON DELETE SET NULL,
  ADD COLUMN "smoke_regression_tolerance" real NOT NULL DEFAULT 0.1;

-- Golden runs table
CREATE TABLE "golden_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "run_id" uuid NOT NULL REFERENCES "heartbeat_runs"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "frozen_score" real,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "golden_runs_company_idx" ON "golden_runs" ("company_id");
CREATE INDEX "golden_runs_agent_idx" ON "golden_runs" ("agent_id");
CREATE INDEX "golden_runs_run_idx" ON "golden_runs" ("run_id");
