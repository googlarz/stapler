import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";

const float4Array = customType<{ data: number[] | null; driverData: number[] | string | null }>({
  dataType() { return "real[]"; },
  toDriver(value: number[] | null): string | null {
    if (!value) return null;
    return `{${value.join(",")}}`;
  },
  fromDriver(value: number[] | string | null): number[] | null {
    if (!value) return null;
    if (Array.isArray(value)) return (value as unknown[]).map(Number);
    if (typeof value === "string") {
      const s = value.trim();
      if (s === "{}") return [];
      return s.slice(1, -1).split(",").map(Number);
    }
    return null;
  },
});
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

/**
 * Company-wide shared memory store. Lets any agent save short free-text notes
 * scoped to a company rather than a specific agent — useful for cross-agent
 * knowledge (e.g. preferred vendors, style conventions, recurring decisions).
 *
 * Dedupe is by `content_hash` (sha256 of the trimmed content). The unique
 * index on (company_id, content_hash) lets the save path use
 * `ON CONFLICT DO NOTHING` so concurrent agents never see spurious conflicts.
 *
 * `wiki_slug` (nullable) marks a row as a named wiki page — compiled knowledge
 * that all agents see at every wakeup. Partial unique index on
 * (company_id, wiki_slug) WHERE wiki_slug IS NOT NULL enables upsert-by-slug
 * semantics without affecting deduplication of regular episodic memories.
 *
 * `created_by_agent_id` is a nullable FK so we know which agent authored
 * the memory. `created_in_run_id` is a loose reference to `heartbeat_runs.id`
 * — no FK, because we do not want cascading deletes to wipe memory history
 * when runs are pruned.
 */
export const companyMemories = pgTable(
  "company_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    contentBytes: integer("content_bytes").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    wikiSlug: text("wiki_slug"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    createdInRunId: uuid("created_in_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Optional expiry. When set and past, the row is excluded from lists, searches, and injection. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /**
     * 1536-dim float32 embedding from OpenAI text-embedding-3-small.
     * NULL for rows saved before OPENAI_API_KEY was configured.
     */
    embedding: float4Array("embedding"),
  },
  (table) => ({
    companyCreatedAtIdx: index("company_memories_company_created_at_idx").on(
      table.companyId,
      table.createdAt,
    ),
    contentTrgmIdx: index("company_memories_content_trgm_idx").using(
      "gin",
      sql`${table.content} gin_trgm_ops`,
    ),
    uniqueCompanyHash: uniqueIndex("company_memories_company_content_hash_key").on(
      table.companyId,
      table.contentHash,
    ),
    uniqueCompanyWikiSlug: uniqueIndex("company_memories_company_wiki_slug_key")
      .on(table.companyId, table.wikiSlug)
      .where(sql`${table.wikiSlug} IS NOT NULL`),
  }),
);
