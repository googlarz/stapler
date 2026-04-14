/**
 * Company-scoped shared memory service.
 *
 * Provides `save` and `list` operations over the `company_memories` table.
 * Memories are shared across all agents within a company — unlike agent_memories
 * which are scoped to a single agent.
 *
 * Deduplication: content is hashed with SHA-256; inserting duplicate content
 * for the same company is a no-op (ON CONFLICT DO NOTHING) and returns the
 * existing row.
 *
 * Content size: enforced at the service layer via `PAPERCLIP_MEMORY_MAX_CONTENT_BYTES`
 * (default 4096 bytes). Callers receive `MemoryContentTooLargeError` when exceeded.
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";

/** pg_trgm similarity threshold for company memory search (mirrors agent memory default). */
const DEFAULT_SEARCH_THRESHOLD = 0.1;
import type { Db } from "@paperclipai/db";
import { companyMemories } from "@paperclipai/db";
import { MemoryContentTooLargeError } from "./agent-memories.js";

export { MemoryContentTooLargeError };

export const DEFAULT_MAX_CONTENT_BYTES = 4096;

export type CompanyMemory = typeof companyMemories.$inferSelect;

export interface SaveCompanyMemoryInput {
  companyId: string;
  content: string;
  tags?: string[];
  createdByAgentId?: string;
  createdInRunId?: string;
  /** Optional TTL. When set and past, the memory is excluded from lists/searches/injection. */
  expiresAt?: Date | null;
}

export interface ListCompanyMemoryInput {
  companyId: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

function readPositiveInt(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function normalizeTags(tags: string[] | undefined | null): string[] {
  if (!tags || tags.length === 0) return [];
  return Array.from(
    new Set(
      tags
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0),
    ),
  );
}

/** SQL predicate that filters out expired company memory rows at query time. */
const notExpired = or(
  isNull(companyMemories.expiresAt),
  gt(companyMemories.expiresAt, sql`NOW()`),
)!;

export function companyMemoryService(db: Db) {
  return {
    /**
     * Save a memory scoped to a company. Idempotent: duplicate content
     * (matched by sha256 of the trimmed string) for the same company is
     * a no-op; the existing row is returned unchanged.
     *
     * Throws `MemoryContentTooLargeError` when the content exceeds the
     * configured byte limit.
     */
    save: async (input: SaveCompanyMemoryInput): Promise<CompanyMemory> => {
      const trimmed = input.content.trim();
      if (trimmed.length === 0) {
        throw new Error("content cannot be empty after trimming");
      }
      const contentBytes = Buffer.byteLength(trimmed, "utf8");
      const maxContentBytes = readPositiveInt(
        "PAPERCLIP_MEMORY_MAX_CONTENT_BYTES",
        DEFAULT_MAX_CONTENT_BYTES,
      );
      if (contentBytes > maxContentBytes) {
        throw new MemoryContentTooLargeError(contentBytes, maxContentBytes);
      }
      const contentHash = hashContent(trimmed);
      const tags = normalizeTags(input.tags);

      // Insert-or-ignore. ON CONFLICT DO NOTHING means the RETURNING clause
      // returns nothing on conflict, so we fall back to a SELECT.
      const inserted = await db
        .insert(companyMemories)
        .values({
          companyId: input.companyId,
          content: trimmed,
          contentHash,
          contentBytes,
          tags,
          createdByAgentId: input.createdByAgentId ?? null,
          createdInRunId: input.createdInRunId ?? null,
          expiresAt: input.expiresAt ?? null,
        })
        .onConflictDoNothing()
        .returning();

      if (inserted.length > 0) {
        return inserted[0];
      }

      // Row already exists — return it.
      const existing = await db
        .select()
        .from(companyMemories)
        .where(
          and(
            eq(companyMemories.companyId, input.companyId),
            eq(companyMemories.contentHash, contentHash),
          ),
        )
        .limit(1);

      if (!existing[0]) {
        // Extremely unlikely race: another transaction deleted the row between
        // our INSERT and this SELECT. Retry once by re-inserting.
        const retried = await db
          .insert(companyMemories)
          .values({
            companyId: input.companyId,
            content: trimmed,
            contentHash,
            contentBytes,
            tags,
            createdByAgentId: input.createdByAgentId ?? null,
            createdInRunId: input.createdInRunId ?? null,
          })
          .returning();
        return retried[0];
      }

      return existing[0];
    },

    /**
     * List memories for a company, newest first. Supports optional tag
     * AND-filter and cursor-style pagination via limit/offset.
     *
     * - `limit` is clamped to [1, 200] (default 50)
     * - `offset` defaults to 0
     * - `tags` filters to memories whose tags array contains ALL supplied tags
     */
    list: async (input: ListCompanyMemoryInput): Promise<CompanyMemory[]> => {
      const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
      const offset = Math.max(0, input.offset ?? 0);
      const tagsFilter = normalizeTags(input.tags);

      const conditions = [eq(companyMemories.companyId, input.companyId), notExpired];
      if (tagsFilter.length > 0) {
        conditions.push(
          sql`${companyMemories.tags} @> ${JSON.stringify(tagsFilter)}::jsonb`,
        );
      }

      return db
        .select()
        .from(companyMemories)
        .where(and(...conditions))
        .orderBy(desc(companyMemories.createdAt))
        .limit(limit)
        .offset(offset);
    },

    /**
     * Keyword search over a company's memories via pg_trgm similarity.
     * Rows are scored with `similarity(content, $q)` and filtered by the
     * default threshold (0.1). Results are ordered by score descending.
     */
    search: async (input: {
      companyId: string;
      q: string;
      tags?: string[];
      limit?: number;
    }): Promise<(CompanyMemory & { score: number })[]> => {
      const trimmedQ = input.q.trim();
      if (trimmedQ.length === 0) return [];
      const limit = Math.max(1, Math.min(input.limit ?? 10, 100));
      const tagsFilter = normalizeTags(input.tags);

      const conditions = [
        eq(companyMemories.companyId, input.companyId),
        notExpired,
        sql`similarity(${companyMemories.content}, ${trimmedQ}) >= ${DEFAULT_SEARCH_THRESHOLD}`,
      ];
      if (tagsFilter.length > 0) {
        conditions.push(sql`${companyMemories.tags} @> ${JSON.stringify(tagsFilter)}::jsonb`);
      }

      const rows = await db
        .select({
          row: companyMemories,
          score: sql<number>`similarity(${companyMemories.content}, ${trimmedQ})`.as("score"),
        })
        .from(companyMemories)
        .where(and(...conditions))
        .orderBy(desc(sql`score`), desc(companyMemories.createdAt))
        .limit(limit);

      return rows.map((r) => ({ ...r.row, score: Number(r.score) || 0 }));
    },

    /**
     * Delete a company memory by id, scoped to companyId for safety.
     * Returns the deleted row, or null if it didn't exist or belonged to
     * a different company.
     */
    remove: async (id: string, companyId: string): Promise<CompanyMemory | null> =>
      db
        .delete(companyMemories)
        .where(and(eq(companyMemories.id, id), eq(companyMemories.companyId, companyId)))
        .returning()
        .then((rows) => rows[0] ?? null),

    /**
     * Create or fully replace a named company wiki page. Upserts by
     * (companyId, wikiSlug). Content is fully replaced on update —
     * wiki pages are maintained documents, not append-only notes.
     */
    wikiUpsert: async (input: {
      companyId: string;
      content: string;
      wikiSlug: string;
      tags?: string[];
      createdByAgentId?: string;
      createdInRunId?: string;
    }): Promise<CompanyMemory> => {
      const trimmed = input.content.trim();
      if (trimmed.length === 0) throw new Error("content cannot be empty after trimming");
      const maxContentBytes = readPositiveInt("PAPERCLIP_MEMORY_MAX_CONTENT_BYTES", DEFAULT_MAX_CONTENT_BYTES);
      const contentBytes = Buffer.byteLength(trimmed, "utf8");
      if (contentBytes > maxContentBytes) throw new MemoryContentTooLargeError(contentBytes, maxContentBytes);
      const contentHash = hashContent(trimmed);
      const tags = normalizeTags(input.tags);
      const slug = input.wikiSlug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 64);
      if (!slug) throw new Error("wikiSlug must produce a non-empty slug after normalization");

      const [row] = await db
        .insert(companyMemories)
        .values({
          companyId: input.companyId,
          content: trimmed,
          contentHash,
          contentBytes,
          tags,
          wikiSlug: slug,
          createdByAgentId: input.createdByAgentId ?? null,
          createdInRunId: input.createdInRunId ?? null,
        })
        .onConflictDoUpdate({
          target: [companyMemories.companyId, companyMemories.wikiSlug],
          targetWhere: sql`${companyMemories.wikiSlug} IS NOT NULL`,
          set: { content: trimmed, contentHash, contentBytes, tags, updatedAt: sql`now()` },
        })
        .returning();
      return row;
    },

    wikiGet: async (companyId: string, slug: string): Promise<CompanyMemory | null> =>
      db.select().from(companyMemories)
        .where(and(eq(companyMemories.companyId, companyId), eq(companyMemories.wikiSlug, slug)))
        .limit(1)
        .then((rows) => rows[0] ?? null),

    /** List all wiki pages for a company, alphabetical by slug. Safety cap 500. */
    wikiList: async (companyId: string): Promise<CompanyMemory[]> =>
      db.select().from(companyMemories)
        .where(and(eq(companyMemories.companyId, companyId), isNotNull(companyMemories.wikiSlug), notExpired))
        .orderBy(asc(companyMemories.wikiSlug))
        .limit(500),

    wikiRemove: async (companyId: string, slug: string): Promise<CompanyMemory | null> =>
      db.delete(companyMemories)
        .where(and(eq(companyMemories.companyId, companyId), eq(companyMemories.wikiSlug, slug)))
        .returning()
        .then((rows) => rows[0] ?? null),

    /**
     * Patch mutable metadata on an existing episodic company memory.
     * Only episodic memories (wikiSlug IS NULL) can be patched; wiki pages
     * use `wikiUpsert` for updates.
     *
     * Fields not present in `update` are left unchanged.
     * Pass `expiresAt: null` explicitly to clear an existing TTL.
     *
     * Returns the updated row, or null if not found / wrong company.
     */
    patch: async (
      id: string,
      companyId: string,
      update: {
        tags?: string[];
        expiresAt?: Date | null;
      },
    ): Promise<CompanyMemory | null> => {
      const setValues: {
        updatedAt: ReturnType<typeof sql>;
        tags?: string[];
        expiresAt?: Date | null;
      } = { updatedAt: sql`now()` };
      if (update.tags !== undefined) {
        setValues.tags = normalizeTags(update.tags);
      }
      if ("expiresAt" in update) {
        setValues.expiresAt = update.expiresAt ?? null;
      }

      return db
        .update(companyMemories)
        .set(setValues)
        .where(
          and(
            eq(companyMemories.id, id),
            eq(companyMemories.companyId, companyId),
            isNull(companyMemories.wikiSlug),
          ),
        )
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    /**
     * Memory health statistics for a company — counts and byte totals split by
     * episodic vs wiki. Non-expired rows only.
     */
    stats: async (companyId: string): Promise<{
      episodic: { count: number; bytes: number };
      wiki: { count: number; bytes: number };
      total: { count: number; bytes: number };
    }> => {
      const rows = await db
        .select({
          isWiki: sql<boolean>`(${companyMemories.wikiSlug} IS NOT NULL)`,
          count: sql<number>`count(*)::int`,
          bytes: sql<number>`coalesce(sum(${companyMemories.contentBytes}), 0)::int`,
        })
        .from(companyMemories)
        .where(and(eq(companyMemories.companyId, companyId), notExpired))
        .groupBy(sql`(${companyMemories.wikiSlug} IS NOT NULL)`);

      let episodic = { count: 0, bytes: 0 };
      let wiki = { count: 0, bytes: 0 };
      for (const r of rows) {
        if (r.isWiki) wiki = { count: r.count, bytes: Number(r.bytes) };
        else episodic = { count: r.count, bytes: Number(r.bytes) };
      }
      return {
        episodic,
        wiki,
        total: { count: episodic.count + wiki.count, bytes: episodic.bytes + wiki.bytes },
      };
    },
  };
}
