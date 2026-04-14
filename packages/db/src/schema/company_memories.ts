import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
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
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    wikiSlug: text("wiki_slug"),
    createdInRunId: uuid("created_in_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
