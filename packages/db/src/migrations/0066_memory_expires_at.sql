-- Wave 8: Memory TTL (expires_at)
-- Agents can save time-limited episodic memories; once past expiry they are
-- filtered from lists, searches, and run-start injection. Wiki pages may also
-- carry expiry (rarely useful in practice) — the same filter applies
-- universally without wiki special-casing.

ALTER TABLE "agent_memories" ADD COLUMN IF NOT EXISTS "expires_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "company_memories" ADD COLUMN IF NOT EXISTS "expires_at" timestamptz;
--> statement-breakpoint
-- Partial index for efficient expiry sweeps — only rows with a set expiry.
CREATE INDEX IF NOT EXISTS "agent_memories_expires_at_idx"
  ON "agent_memories" ("expires_at")
  WHERE "expires_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_memories_expires_at_idx"
  ON "company_memories" ("expires_at")
  WHERE "expires_at" IS NOT NULL;
