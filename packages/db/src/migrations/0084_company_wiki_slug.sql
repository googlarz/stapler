-- Add wiki_slug to company_memories so teams can maintain shared compiled knowledge
-- (style guides, product conventions, vendor preferences) that all agents receive.
ALTER TABLE "company_memories" ADD COLUMN IF NOT EXISTS "wiki_slug" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_memories_company_wiki_slug_key"
  ON "company_memories" ("company_id", "wiki_slug")
  WHERE "wiki_slug" IS NOT NULL;
