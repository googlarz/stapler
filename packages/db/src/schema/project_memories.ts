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
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";
import { projects } from "./projects.js";

/**
 * PostgreSQL real[] column for 1536-dim float32 embedding vectors.
 * Same encoding as agent_memories — see that file for full docs.
 */
const float4Array = customType<{ data: number[] | null; driverData: number[] | string | null }>({
  dataType() { return "real[]"; },
  toDriver(value: number[] | null): string | null {
    if (!value) return null;
    const sanitized = value.map((n) => (Number.isFinite(n) ? n : 0));
    return `{${sanitized.join(",")}}`;
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

/**
 * Project-scoped memory store. Allows agents working on the same project
 * to share learned context — architectural decisions, discovered constraints,
 * team preferences — that is relevant to the project but not tied to any
 * single agent.
 *
 * Deduplication, embedding, and expiry follow the same conventions as
 * `agent_memories`. Cross-scope injection in `memory-injection.ts` merges
 * results from agent + project + company memories before passing them to
 * the adapter.
 */
export const projectMemories = pgTable(
  "project_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    contentBytes: integer("content_bytes").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Loose reference to the run that produced this memory — no FK. */
    createdInRunId: uuid("created_in_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Optional expiry. Past-expiry rows are excluded from search and injection. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /**
     * 1536-dim float32 embedding from OpenAI text-embedding-3-small.
     * NULL for rows saved before OPENAI_API_KEY was configured.
     */
    embedding: float4Array("embedding"),
  },
  (table) => ({
    projectCreatedAtIdx: index("project_memories_project_created_at_idx").on(
      table.projectId,
      table.createdAt,
    ),
    companyIdx: index("project_memories_company_idx").on(table.companyId),
    contentTrgmIdx: index("project_memories_content_trgm_idx").using(
      "gin",
      sql`${table.content} gin_trgm_ops`,
    ),
    uniqueProjectHash: uniqueIndex("project_memories_project_content_hash_key").on(
      table.projectId,
      table.contentHash,
    ),
  }),
);
