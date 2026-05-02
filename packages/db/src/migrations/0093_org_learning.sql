-- Pillar 6: Organizational Learning — routing outcomes + decomposition outcomes

CREATE TABLE "routing_outcomes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "issue_id" uuid NOT NULL REFERENCES "issues"("id") ON DELETE CASCADE,
  "assigned_agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "issue_title_norm" text,
  "issue_labels" text,
  "run_score" real,
  "resolved" boolean NOT NULL DEFAULT false,
  "resolved_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "routing_outcomes_company_idx" ON "routing_outcomes" ("company_id");
CREATE INDEX "routing_outcomes_agent_idx" ON "routing_outcomes" ("assigned_agent_id");
CREATE INDEX "routing_outcomes_issue_idx" ON "routing_outcomes" ("issue_id");

CREATE TABLE "decomposition_outcomes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "goal_id" uuid NOT NULL REFERENCES "goals"("id") ON DELETE CASCADE,
  "goal_title_norm" text,
  "issue_titles" text NOT NULL,
  "rework_count" integer NOT NULL DEFAULT 0,
  "outcome_score" real,
  "finalized_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "decomposition_outcomes_company_idx" ON "decomposition_outcomes" ("company_id");
CREATE INDEX "decomposition_outcomes_goal_idx" ON "decomposition_outcomes" ("goal_id");
