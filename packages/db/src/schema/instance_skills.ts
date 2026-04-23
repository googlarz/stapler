import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Instance-level skill registry.
 *
 * A single shared set of skills for the entire Stapler instance —
 * no per-company scoping. All agents on the instance see the same skills
 * and can invoke them via slash commands (/skill-name) in issue threads.
 */
export const instanceSkills = pgTable(
  "instance_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Unique slug-based key used in slash commands, e.g. "gsd:plan-phase". */
    key: text("key").notNull(),
    /** URL-safe slug derived from the skill directory name. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** The SKILL.md markdown content, injected into the agent at invocation time. */
    markdown: text("markdown").notNull(),
    /** Where the skill came from: "local_path" | "github" | "skills_sh" | "catalog" */
    sourceType: text("source_type").notNull().default("local_path"),
    /** Path or URL to the skill source (e.g. a GitHub URL or local directory). */
    sourceLocator: text("source_locator"),
    /** Git ref / branch / tag if sourced from a remote repository. */
    sourceRef: text("source_ref"),
    /** "markdown_only" or "full_execution" — controls how deeply the skill is trusted. */
    trustLevel: text("trust_level").notNull().default("markdown_only"),
    /** Compatibility status: "compatible" | "incompatible" | "unknown" */
    compatibility: text("compatibility").notNull().default("compatible"),
    /** Inventory of files included in the skill package (for full_execution skills). */
    fileInventory: jsonb("file_inventory").$type<Array<Record<string, unknown>>>().notNull().default([]),
    /** Arbitrary metadata stored alongside the skill. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    keyUniqueIdx: uniqueIndex("instance_skills_key_idx").on(table.key),
    slugUniqueIdx: uniqueIndex("instance_skills_slug_idx").on(table.slug),
    nameIdx: index("instance_skills_name_idx").on(table.name),
  }),
);
