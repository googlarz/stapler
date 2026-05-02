CREATE TABLE IF NOT EXISTS "company_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "content" text NOT NULL,
  "content_hash" text NOT NULL,
  "content_bytes" integer NOT NULL,
  "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_by_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "created_in_run_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_memories_company_created_at_idx"
  ON "company_memories" ("company_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_memories_content_trgm_idx"
  ON "company_memories" USING gin ("content" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_memories_company_content_hash_key"
  ON "company_memories" ("company_id", "content_hash");
