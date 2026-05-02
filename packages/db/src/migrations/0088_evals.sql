-- Eval suites: named test-case collections targeting a specific agent
CREATE TABLE "eval_suites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "eval_suites_company_idx" ON "eval_suites"("company_id");
CREATE INDEX "eval_suites_agent_idx" ON "eval_suites"("agent_id");

-- Eval cases: individual test inputs + scoring criteria
CREATE TABLE "eval_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "suite_id" uuid NOT NULL REFERENCES "eval_suites"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "input_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "criteria" text NOT NULL,
  "expected_tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "eval_cases_suite_idx" ON "eval_cases"("suite_id");

-- Eval runs: a single execution of a suite
CREATE TABLE "eval_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "suite_id" uuid NOT NULL REFERENCES "eval_suites"("id") ON DELETE CASCADE,
  "triggered_by" text NOT NULL DEFAULT 'api',
  "status" text NOT NULL DEFAULT 'pending',
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "summary_json" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "eval_runs_suite_idx" ON "eval_runs"("suite_id");
CREATE INDEX "eval_runs_status_idx" ON "eval_runs"("status");

-- Eval case results: per-case score + judge output within a run
CREATE TABLE "eval_case_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "eval_runs"("id") ON DELETE CASCADE,
  "case_id" uuid NOT NULL REFERENCES "eval_cases"("id") ON DELETE CASCADE,
  "heartbeat_run_id" uuid,  -- loose ref to heartbeat_runs; no FK (avoids cascade wipe)
  "status" text NOT NULL DEFAULT 'pending',
  "score" real,
  "judge_output" text,
  "stdout_excerpt" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "eval_case_results_run_idx" ON "eval_case_results"("run_id");
CREATE INDEX "eval_case_results_case_idx" ON "eval_case_results"("case_id");
