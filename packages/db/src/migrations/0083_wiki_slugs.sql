-- Add wiki_slug to agent_memories (nullable; when set, this row is a named wiki page)
ALTER TABLE "agent_memories" ADD COLUMN IF NOT EXISTS "wiki_slug" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_memories_agent_wiki_slug_key"
  ON "agent_memories" ("agent_id", "wiki_slug")
  WHERE "wiki_slug" IS NOT NULL;
