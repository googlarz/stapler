-- Wave 8: Semantic embeddings for memory search
-- Adds a nullable real[] column (1536 dims) to store float32 vectors from
-- OpenAI text-embedding-3-small. When OPENAI_API_KEY is configured, every
-- saved memory is automatically embedded. Search uses app-side cosine
-- similarity for embedded rows and falls back to pg_trgm when no API key
-- is present or the embedding call fails.
--
-- Column is real[] so a future migration to pgvector vector(1536) is a
-- simple ALTER COLUMN ... TYPE vector(1536) USING embedding::vector(1536)
-- once pgvector ships in embedded-postgres.

ALTER TABLE "agent_memories" ADD COLUMN IF NOT EXISTS "embedding" real[];
--> statement-breakpoint
ALTER TABLE "company_memories" ADD COLUMN IF NOT EXISTS "embedding" real[];
