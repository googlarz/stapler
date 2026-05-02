-- Instance-level skill registry.
-- A single shared set of skills for the entire Stapler instance,
-- replacing per-company skill scoping for slash-command execution.
CREATE TABLE IF NOT EXISTS "instance_skills" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "key"            TEXT NOT NULL,
  "slug"           TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "description"    TEXT,
  "markdown"       TEXT NOT NULL,
  "source_type"    TEXT NOT NULL DEFAULT 'local_path',
  "source_locator" TEXT,
  "source_ref"     TEXT,
  "trust_level"    TEXT NOT NULL DEFAULT 'markdown_only',
  "compatibility"  TEXT NOT NULL DEFAULT 'compatible',
  "file_inventory" JSONB NOT NULL DEFAULT '[]',
  "metadata"       JSONB,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "instance_skills_key_idx"  ON "instance_skills" ("key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "instance_skills_slug_idx" ON "instance_skills" ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "instance_skills_name_idx" ON "instance_skills" ("name");
