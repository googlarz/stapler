-- Pillar 8: Workflow Learning — playbooks + playbook experiments

CREATE TABLE "playbooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "title" text NOT NULL,
  "task_pattern_norm" text NOT NULL,
  "steps" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "win_rate" real,
  "sample_size" integer NOT NULL DEFAULT 0,
  "ab_testing" integer NOT NULL DEFAULT 0,
  "active" integer NOT NULL DEFAULT 1,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "playbooks_agent_idx" ON "playbooks" ("agent_id");
CREATE INDEX "playbooks_company_idx" ON "playbooks" ("company_id");

CREATE TABLE "playbook_experiments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "control_playbook_id" uuid NOT NULL REFERENCES "playbooks"("id"),
  "challenger_playbook_id" uuid NOT NULL REFERENCES "playbooks"("id"),
  "status" text NOT NULL DEFAULT 'running',
  "control_wins" integer NOT NULL DEFAULT 0,
  "challenger_wins" integer NOT NULL DEFAULT 0,
  "total_runs" integer NOT NULL DEFAULT 0,
  "min_runs" integer NOT NULL DEFAULT 10,
  "control_win_rate" real,
  "challenger_win_rate" real,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "concluded_at" timestamp
);

CREATE INDEX "playbook_experiments_company_idx" ON "playbook_experiments" ("company_id");
