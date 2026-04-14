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
import { and, desc, eq, sql } from "drizzle-orm";
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

      const conditions = [eq(companyMemories.companyId, input.companyId)];
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
  };
}
