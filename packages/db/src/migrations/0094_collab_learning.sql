-- Pillar 7: Collaboration Learning — delegation edges

CREATE TABLE "delegation_edges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "from_agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "to_agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "issue_id" uuid REFERENCES "issues"("id") ON DELETE SET NULL,
  "depth" integer NOT NULL DEFAULT 0,
  "outcome" text,
  "ping_pong_detected" boolean NOT NULL DEFAULT false,
  "depth_runaway_detected" boolean NOT NULL DEFAULT false,
  "round_trip_ms" integer,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "resolved_at" timestamp
);

CREATE INDEX "delegation_edges_company_idx" ON "delegation_edges" ("company_id");
CREATE INDEX "delegation_edges_from_agent_idx" ON "delegation_edges" ("from_agent_id");
CREATE INDEX "delegation_edges_to_agent_idx" ON "delegation_edges" ("to_agent_id");
CREATE INDEX "delegation_edges_issue_idx" ON "delegation_edges" ("issue_id");
