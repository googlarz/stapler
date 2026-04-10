import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentMemories } from "@paperclipai/db";
import type {
  AgentMemory,
  AgentMemorySearchResult,
  AgentMemorySaveResult,
} from "@paperclipai/shared";

/**
 * Maximum number of memories a single agent may retain. Oldest are
 * evicted on save when the count exceeds this. Configurable via
 * `PAPERCLIP_MEMORY_MAX_PER_AGENT`.
 */
export const DEFAULT_MAX_MEMORIES_PER_AGENT = 500;

/**
 * Maximum byte size of a single memory's `content` after trimming.
 * Enforced at the service layer so all callers (HTTP route, future
 * MCP tool proxy, direct service calls from tests) share the same
 * limit. Configurable via `PAPERCLIP_MEMORY_MAX_CONTENT_BYTES`.
 */
export const DEFAULT_MAX_CONTENT_BYTES = 4096;

/**
 * Trigram similarity threshold for `search`. Rows below this are
 * excluded. 0.1 is deliberately lower than pg_trgm's default of 0.3
 * so short queries ("french") still match short memories ("user
 * prefers french over english"). Configurable via
 * `PAPERCLIP_MEMORY_SEARCH_THRESHOLD`.
 */
export const DEFAULT_SEARCH_THRESHOLD = 0.1;

function readPositiveInt(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readFloat(envName: string, fallback: number, min: number, max: number): number {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

export function getMemoryLimits() {
  return {
    maxPerAgent: readPositiveInt("PAPERCLIP_MEMORY_MAX_PER_AGENT", DEFAULT_MAX_MEMORIES_PER_AGENT),
    maxContentBytes: readPositiveInt(
      "PAPERCLIP_MEMORY_MAX_CONTENT_BYTES",
      DEFAULT_MAX_CONTENT_BYTES,
    ),
    searchThreshold: readFloat("PAPERCLIP_MEMORY_SEARCH_THRESHOLD", DEFAULT_SEARCH_THRESHOLD, 0, 1),
  };
}

export class MemoryContentTooLargeError extends Error {
  readonly contentBytes: number;
  readonly maxContentBytes: number;
  constructor(contentBytes: number, maxContentBytes: number) {
    super(`Memory content is ${contentBytes} bytes; max is ${maxContentBytes}`);
    this.name = "MemoryContentTooLargeError";
    this.contentBytes = contentBytes;
    this.maxContentBytes = maxContentBytes;
  }
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function normalizeTags(tags: string[] | undefined | null): string[] {
  if (!tags || tags.length === 0) return [];
  return Array.from(new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0)));
}

function rowToMemory(row: typeof agentMemories.$inferSelect): AgentMemory {
  return {
    id: row.id,
    companyId: row.companyId,
    agentId: row.agentId,
    content: row.content,
    contentHash: row.contentHash,
    contentBytes: row.contentBytes,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    // scope column is text in the DB; narrow to the public union when
    // we extend scopes later this cast will still be safe.
    scope: row.scope as AgentMemory["scope"],
    createdInRunId: row.createdInRunId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface SaveMemoryInput {
  companyId: string;
  agentId: string;
  content: string;
  tags?: string[];
  runId?: string | null;
}

export interface SearchMemoryInput {
  agentId: string;
  q: string;
  tags?: string[];
  limit?: number;
}

export interface ListMemoryInput {
  agentId: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

export function agentMemoryService(db: Db) {
  return {
    /**
     * Save a memory for an agent. Idempotent: duplicate content
     * (matched by sha256 of the trimmed string) is a no-op and
     * returns the existing row with `deduped: true`.
     *
     * Runs inside a transaction so the post-insert prune sees
     * exactly-committed state. Activity logging happens outside
     * this function by the caller.
     */
    save: async (input: SaveMemoryInput): Promise<AgentMemorySaveResult> => {
      const trimmed = input.content.trim();
      if (trimmed.length === 0) {
        throw new Error("content cannot be empty after trimming");
      }
      const contentBytes = Buffer.byteLength(trimmed, "utf8");
      const limits = getMemoryLimits();
      if (contentBytes > limits.maxContentBytes) {
        throw new MemoryContentTooLargeError(contentBytes, limits.maxContentBytes);
      }
      const contentHash = hashContent(trimmed);
      const tags = normalizeTags(input.tags);

      return db.transaction(async (tx) => {
        // Insert-or-skip. RETURNING * is empty when the unique index
        // on (agent_id, content_hash) collides, which tells us the row
        // already existed.
        const inserted = await tx
          .insert(agentMemories)
          .values({
            companyId: input.companyId,
            agentId: input.agentId,
            content: trimmed,
            contentHash,
            contentBytes,
            tags,
            createdInRunId: input.runId ?? null,
          })
          .onConflictDoNothing({
            target: [agentMemories.agentId, agentMemories.contentHash],
          })
          .returning();

        let memoryRow: typeof agentMemories.$inferSelect;
        let deduped = false;
        if (inserted.length > 0) {
          memoryRow = inserted[0];
        } else {
          deduped = true;
          const existing = await tx
            .select()
            .from(agentMemories)
            .where(
              and(
                eq(agentMemories.agentId, input.agentId),
                eq(agentMemories.contentHash, contentHash),
              ),
            )
            .limit(1)
            .then((rows) => rows[0] ?? null);
          if (!existing) {
            // Shouldn't happen — unique index guarantees either insert
            // or existing row. Treat as a real error.
            throw new Error("agent memory save: conflict but no existing row found");
          }
          memoryRow = existing;
        }

        // Prune oldest if we're over cap. This is a no-op on dedupe
        // inserts (the count didn't change). It's O(1) SELECT count +
        // one DELETE per over-cap row.
        const countRows = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(agentMemories)
          .where(eq(agentMemories.agentId, input.agentId));
        const total = countRows[0]?.n ?? 0;
        if (total > limits.maxPerAgent) {
          const overflow = total - limits.maxPerAgent;
          // Oldest-first; never delete the row we just inserted/returned.
          const toDelete = await tx
            .select({ id: agentMemories.id })
            .from(agentMemories)
            .where(eq(agentMemories.agentId, input.agentId))
            .orderBy(agentMemories.createdAt)
            .limit(overflow);
          const ids = toDelete
            .map((r) => r.id)
            .filter((id) => id !== memoryRow.id);
          if (ids.length > 0) {
            await tx.delete(agentMemories).where(inArray(agentMemories.id, ids));
          }
        }

        return { memory: rowToMemory(memoryRow), deduped };
      });
    },

    /**
     * Keyword search over one agent's memories via pg_trgm
     * similarity. Rows are scored with `similarity(content, $q)` and
     * filtered by a configurable threshold. Results include the
     * similarity score for UI display and test assertions.
     *
     * For small per-agent corpora (a few hundred rows) this is a
     * seq scan + similarity() call per row. Fast enough without the
     * GIN index; the index is maintained for future scale.
     */
    search: async (input: SearchMemoryInput): Promise<AgentMemorySearchResult[]> => {
      const trimmedQ = input.q.trim();
      if (trimmedQ.length === 0) return [];
      const limits = getMemoryLimits();
      const limit = Math.max(1, Math.min(input.limit ?? 10, 100));
      const tagsFilter = normalizeTags(input.tags);

      const baseConditions = [
        eq(agentMemories.agentId, input.agentId),
        sql`similarity(${agentMemories.content}, ${trimmedQ}) >= ${limits.searchThreshold}`,
      ];
      if (tagsFilter.length > 0) {
        baseConditions.push(
          sql`${agentMemories.tags} @> ${JSON.stringify(tagsFilter)}::jsonb`,
        );
      }

      const rows = await db
        .select({
          row: agentMemories,
          score: sql<number>`similarity(${agentMemories.content}, ${trimmedQ})`.as("score"),
        })
        .from(agentMemories)
        .where(and(...baseConditions))
        .orderBy(desc(sql`score`), desc(agentMemories.createdAt))
        .limit(limit);

      return rows.map((r) => ({
        ...rowToMemory(r.row),
        score: Number(r.score) || 0,
      }));
    },

    /**
     * List an agent's memories, most-recent first. Optional tag AND
     * filter and pagination.
     */
    list: async (input: ListMemoryInput): Promise<AgentMemory[]> => {
      const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
      const offset = Math.max(0, input.offset ?? 0);
      const tagsFilter = normalizeTags(input.tags);

      const conditions = [eq(agentMemories.agentId, input.agentId)];
      if (tagsFilter.length > 0) {
        conditions.push(sql`${agentMemories.tags} @> ${JSON.stringify(tagsFilter)}::jsonb`);
      }

      const rows = await db
        .select()
        .from(agentMemories)
        .where(and(...conditions))
        .orderBy(desc(agentMemories.createdAt))
        .limit(limit)
        .offset(offset);

      return rows.map(rowToMemory);
    },

    getById: async (id: string): Promise<AgentMemory | null> => {
      const row = await db
        .select()
        .from(agentMemories)
        .where(eq(agentMemories.id, id))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      return row ? rowToMemory(row) : null;
    },

    remove: async (id: string): Promise<AgentMemory | null> => {
      const row = await db
        .delete(agentMemories)
        .where(eq(agentMemories.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
      return row ? rowToMemory(row) : null;
    },

    countForAgent: async (agentId: string): Promise<number> => {
      const rows = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(agentMemories)
        .where(eq(agentMemories.agentId, agentId));
      return rows[0]?.n ?? 0;
    },
  };
}
