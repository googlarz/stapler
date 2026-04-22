-- Migration: 0068_project_memories
-- Add project-scoped memory store for cross-agent project knowledge sharing.

CREATE TABLE "project_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "content" text NOT NULL,
  "content_hash" text NOT NULL,
  "content_bytes" integer NOT NULL,
  "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_in_run_id" uuid,
  "expires_at" timestamptz,
  "embedding" real[],
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Deduplicate by (project_id, content_hash) — same as agent_memories dedup strategy
CREATE UNIQUE INDEX "project_memories_project_content_hash_key"
  ON "project_memories"("project_id", "content_hash");

-- Fast lookup by project + recency
CREATE INDEX "project_memories_project_created_at_idx"
  ON "project_memories"("project_id", "created_at");

-- Company-level sweep (e.g. cascade deletes, analytics)
CREATE INDEX "project_memories_company_idx"
  ON "project_memories"("company_id");

-- Trigram search (requires pg_trgm extension, already enabled for agent_memories)
CREATE INDEX "project_memories_content_trgm_idx"
  ON "project_memories" USING GIN ("content" gin_trgm_ops);
