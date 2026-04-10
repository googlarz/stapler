CREATE TABLE IF NOT EXISTS "agent_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "content" text NOT NULL,
  "content_hash" text NOT NULL,
  "content_bytes" integer NOT NULL,
  "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "scope" text NOT NULL DEFAULT 'agent',
  "created_in_run_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_memories_agent_created_at_idx"
  ON "agent_memories" ("agent_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_memories_company_idx"
  ON "agent_memories" ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_memories_content_trgm_idx"
  ON "agent_memories" USING gin ("content" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_memories_agent_content_hash_key"
  ON "agent_memories" ("agent_id", "content_hash");
