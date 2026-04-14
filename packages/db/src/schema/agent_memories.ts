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
 * Per-agent memory store. Lets an agent save short free-text notes
 * during a run and retrieve them later via keyword search.
 *
 * v1 uses `pg_trgm` keyword similarity against `content` (see the
 * gin_trgm_ops index below). Semantic / embedding-backed search is a
 * deferred follow-up PR; the `scope` column is kept for forward
 * compatibility ("agent" today, "company" later) but is NOT enforced
 * outside "agent" yet.
 *
 * Dedupe is by `content_hash` (sha256 of the trimmed content). The
 * unique index on (agent_id, content_hash) lets the save path use
 * `ON CONFLICT DO NOTHING` so a looping agent never sees spurious 409s.
 *
 * `created_in_run_id` is a loose reference to `heartbeat_runs.id` —
 * no FK, because we do not want cascading deletes to wipe memory
 * history when runs are pruned.
 */
export const agentMemories = pgTable(
  "agent_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    contentBytes: integer("content_bytes").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    scope: text("scope").notNull().default("agent"),
    wikiSlug: text("wiki_slug"),
    createdInRunId: uuid("created_in_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Optional expiry. When set and past, the row is excluded from lists, searches, and injection. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => ({
    agentCreatedAtIdx: index("agent_memories_agent_created_at_idx").on(
      table.agentId,
      table.createdAt,
    ),
    companyIdx: index("agent_memories_company_idx").on(table.companyId),
    contentTrgmIdx: index("agent_memories_content_trgm_idx").using(
      "gin",
      sql`${table.content} gin_trgm_ops`,
    ),
    uniqueAgentHash: uniqueIndex("agent_memories_agent_content_hash_key").on(
      table.agentId,
      table.contentHash,
    ),
    uniqueAgentWikiSlug: uniqueIndex("agent_memories_agent_wiki_slug_key")
      .on(table.agentId, table.wikiSlug)
      .where(sql`${table.wikiSlug} IS NOT NULL`),
  }),
);
