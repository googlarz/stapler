/**
 * Simplified per-agent memory store.
 *
 * This is a precursor to the full memory service in upstream PR #3403
 * (feat: implement memory service end to end). That PR introduces a
 * platform-level system with pluggable providers, multi-scope records
 * (company / project / agent / issue / run), automatic extraction from
 * run outputs, and a full operations audit trail.
 *
 * When upstream #3403 lands, absorb it:
 *   1. Add their 5 tables (memory_bindings, memory_binding_targets,
 *      memory_local_records, memory_extraction_jobs, memory_operations).
 *   2. Migrate agent_memories rows → memory_local_records (scopeAgentId).
 *   3. Drop agent_memories and this service; point routes + UI at the new API.
 *
 * The adapter-level injection (agentMemoriesForInjection in AdapterExecutionContext)
 * is already compatible — their adapter change is the same +3 lines Wave 3 added.
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentMemories } from "@paperclipai/db";
import type {
  AgentMemory,
  AgentMemorySearchResult,
  AgentMemorySaveResult,
} from "@paperclipai/shared";
import { cosineSimilarity, getEmbedding, getEmbeddingThreshold } from "./embeddings.js";

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
    wikiSlug: row.wikiSlug ?? null,
    createdInRunId: row.createdInRunId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt ?? null,
  };
}

/** SQL predicate that filters out expired rows at query time. */
const notExpired = or(
  isNull(agentMemories.expiresAt),
  gt(agentMemories.expiresAt, sql`NOW()`),
)!;

export interface SaveMemoryInput {
  companyId: string;
  agentId: string;
  content: string;
  tags?: string[];
  runId?: string | null;
  /** Optional TTL. When set and past, the memory is excluded from lists/searches/injection. */
  expiresAt?: Date | null;
}

export interface SearchMemoryInput {
  agentId: string;
  q: string;
  tags?: string[];
  limit?: number;
  /**
   * When true, wiki pages (wiki_slug IS NOT NULL) are excluded from results.
   * Use this in the MCP memorySearch tool — wiki pages are already injected
   * at wakeup, so surfacing them again in mid-run search is redundant noise.
   */
  excludeWiki?: boolean;
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

      // Generate embedding outside the transaction — the API call must not
      // hold an open transaction while waiting for a network round-trip.
      // On failure or when OPENAI_API_KEY is absent, embedding is null and
      // search falls back to pg_trgm for this row.
      const embedding = await getEmbedding(trimmed);

      return db.transaction(async (tx) => {
        // Serialize concurrent saves for the same agent so the post-insert
        // prune count is always accurate. Without this lock, two parallel
        // saves can both read the count before either prunes and leave the
        // agent over the cap. The lock is transaction-scoped and released
        // automatically on commit/rollback.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext('agent_memories'::text), hashtext(${input.agentId}))`,
        );

        // Insert-or-update. ON CONFLICT DO UPDATE with a no-op set ensures
        // RETURNING always yields the row — either the newly inserted row or
        // the existing conflicting row — eliminating the INSERT + separate
        // SELECT pattern that had a narrow race window where a concurrent
        // DELETE could remove the row between the two statements.
        //
        // Bumping updated_at on conflict is intentional: it records when the
        // memory was last encountered, which is useful for UI display.
        // Delete any expired episodic rows for this agent before counting.
        // This keeps the cap accurate without a separate cron job — garbage
        // collection happens organically on every save.
        await tx
          .delete(agentMemories)
          .where(
            and(
              eq(agentMemories.agentId, input.agentId),
              isNull(agentMemories.wikiSlug),
              isNotNull(agentMemories.expiresAt),
              lt(agentMemories.expiresAt, sql`NOW()`),
            ),
          );

        const [memoryRow] = await tx
          .insert(agentMemories)
          .values({
            companyId: input.companyId,
            agentId: input.agentId,
            content: trimmed,
            contentHash,
            contentBytes,
            tags,
            createdInRunId: input.runId ?? null,
            expiresAt: input.expiresAt ?? null,
            embedding,
          })
          .onConflictDoUpdate({
            target: [agentMemories.agentId, agentMemories.contentHash],
            // Also refresh expiresAt on re-save so callers can extend or
            // set a TTL on a previously non-expiring memory.
            // Embedding is not updated — content is identical, so the vector is too.
            set: { updatedAt: sql`now()`, expiresAt: input.expiresAt ?? null },
          })
          .returning();

        // Detect duplicate: on a fresh INSERT both timestamps are set to the
        // same transaction-start `now()`. On a conflict DO UPDATE, createdAt
        // is the original timestamp while updatedAt becomes the current
        // transaction's now(), so they differ.
        const deduped = memoryRow.createdAt.getTime() !== memoryRow.updatedAt.getTime();

        // Prune oldest if we're over cap. This is a no-op on dedupe
        // inserts (the count didn't change). It's O(1) SELECT count +
        // one DELETE per over-cap row.
        //
        // Wiki pages (wiki_slug IS NOT NULL) are excluded from both the
        // count and the eviction candidates — they are compiled knowledge
        // meant to survive indefinitely, not episodic notes subject to the
        // rolling cap.
        const countRows = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(agentMemories)
          .where(and(eq(agentMemories.agentId, input.agentId), isNull(agentMemories.wikiSlug)));
        const total = countRows[0]?.n ?? 0;
        if (total > limits.maxPerAgent) {
          const overflow = total - limits.maxPerAgent;
          // Oldest-first. We exclude the row we just inserted/returned
          // directly in the WHERE clause so the LIMIT always returns
          // exactly `overflow` deletable rows — filtering after the
          // fact would under-delete by one on createdAt ties (rapid
          // saves within the same now() tick can collide because
          // PostgreSQL's timestamp resolution is microsecond-level,
          // not nanosecond).
          const toDelete = await tx
            .select({ id: agentMemories.id })
            .from(agentMemories)
            .where(
              and(
                eq(agentMemories.agentId, input.agentId),
                isNull(agentMemories.wikiSlug),
                ne(agentMemories.id, memoryRow.id),
              ),
            )
            .orderBy(agentMemories.createdAt)
            .limit(overflow);
          const ids = toDelete.map((r) => r.id);
          if (ids.length > 0) {
            await tx.delete(agentMemories).where(inArray(agentMemories.id, ids));
          }
        }

        return { memory: rowToMemory(memoryRow), deduped };
      });
    },

    /**
     * Search an agent's memories. Strategy:
     *
     * 1. **Semantic (default when OPENAI_API_KEY is set)** — embed the query,
     *    fetch up to 1 000 non-expired rows in-memory, compute cosine
     *    similarity for rows that have an embedding, return the top-K above
     *    a configurable threshold. Falls through to pg_trgm if the API call
     *    fails or no embedded rows are found (e.g. all rows pre-date the
     *    embedding feature rollout).
     *
     * 2. **Keyword fallback (pg_trgm)** — original trigram search used when
     *    OPENAI_API_KEY is absent or when the semantic path yields nothing.
     *
     * App-side cosine similarity is fast enough at Odysseia scale (≤500
     * episodic rows per agent). When the corpus grows, a pgvector IVFFlat
     * index can replace the full-scan without changing the service API.
     */
    search: async (input: SearchMemoryInput): Promise<AgentMemorySearchResult[]> => {
      const trimmedQ = input.q.trim();
      if (trimmedQ.length === 0) return [];
      const limits = getMemoryLimits();
      const limit = Math.max(1, Math.min(input.limit ?? 10, 100));
      const tagsFilter = normalizeTags(input.tags);

      // --- Semantic path ---
      const queryEmbedding = await getEmbedding(trimmedQ);
      if (queryEmbedding) {
        const baseConditions = [eq(agentMemories.agentId, input.agentId), notExpired];
        if (tagsFilter.length > 0) {
          baseConditions.push(
            sql`${agentMemories.tags} @> ${JSON.stringify(tagsFilter)}::jsonb`,
          );
        }
        if (input.excludeWiki) {
          baseConditions.push(isNull(agentMemories.wikiSlug));
        }

        const allRows = await db
          .select()
          .from(agentMemories)
          .where(and(...baseConditions))
          // Fetch most-recent first so ties resolve by recency.
          .orderBy(desc(agentMemories.createdAt))
          .limit(1000);

        const threshold = getEmbeddingThreshold();
        const scored = allRows
          .filter((r): r is typeof r & { embedding: number[] } =>
            Array.isArray(r.embedding) && (r.embedding as number[]).length === queryEmbedding.length,
          )
          .map((r) => ({
            row: r,
            score: cosineSimilarity(queryEmbedding, r.embedding),
          }))
          .filter((r) => r.score >= threshold)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        if (scored.length > 0) {
          return scored.map(({ row, score }) => ({ ...rowToMemory(row), score }));
        }
        // Fall through: no embedded rows found → pg_trgm covers un-embedded rows.
      }

      // --- pg_trgm fallback ---
      const baseConditions = [
        eq(agentMemories.agentId, input.agentId),
        notExpired,
        sql`similarity(${agentMemories.content}, ${trimmedQ}) >= ${limits.searchThreshold}`,
      ];
      if (tagsFilter.length > 0) {
        baseConditions.push(
          sql`${agentMemories.tags} @> ${JSON.stringify(tagsFilter)}::jsonb`,
        );
      }
      if (input.excludeWiki) {
        baseConditions.push(isNull(agentMemories.wikiSlug));
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

      const conditions = [eq(agentMemories.agentId, input.agentId), notExpired];
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

    /**
     * Delete a memory scoped to the given agent. Both `id` and
     * `agentId` must match — if the row belongs to a different agent
     * the DELETE is a no-op and returns null. This closes a TOCTOU
     * gap where the route layer was the only enforcer of ownership:
     * any future caller that skipped the pre-check would have
     * deleted any agent's row by bare id.
     */
    remove: async (id: string, agentId: string): Promise<AgentMemory | null> => {
      const row = await db
        .delete(agentMemories)
        .where(and(eq(agentMemories.id, id), eq(agentMemories.agentId, agentId)))
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

    /**
     * Create or update a named wiki page for an agent. Upserts by (agentId, wikiSlug).
     * The content is fully replaced on update — wiki pages are maintained documents,
     * not append-only notes.
     */
    wikiUpsert: async (input: {
      companyId: string;
      agentId: string;
      wikiSlug: string;
      content: string;
      tags?: string[];
      runId?: string | null;
    }): Promise<AgentMemory> => {
      const trimmed = input.content.trim();
      if (trimmed.length === 0) throw new Error("content cannot be empty after trimming");
      const limits = getMemoryLimits();
      const contentBytes = Buffer.byteLength(trimmed, "utf8");
      if (contentBytes > limits.maxContentBytes) throw new MemoryContentTooLargeError(contentBytes, limits.maxContentBytes);
      const contentHash = hashContent(trimmed);
      const tags = normalizeTags(input.tags);
      const slug = input.wikiSlug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 64);
      if (!slug) throw new Error("wikiSlug must produce a non-empty slug after normalization");

      // Generate embedding for the wiki content (outside any transaction).
      const embedding = await getEmbedding(trimmed);

      const [row] = await db
        .insert(agentMemories)
        .values({ companyId: input.companyId, agentId: input.agentId, content: trimmed, contentHash, contentBytes, tags, wikiSlug: slug, createdInRunId: input.runId ?? null, embedding })
        .onConflictDoUpdate({
          target: [agentMemories.agentId, agentMemories.wikiSlug],
          targetWhere: sql`${agentMemories.wikiSlug} IS NOT NULL`,
          // Update embedding on wiki upsert — content may have changed.
          set: { content: trimmed, contentHash, contentBytes, tags, updatedAt: sql`now()`, embedding },
        })
        .returning();
      return rowToMemory(row);
    },

    wikiGet: async (agentId: string, slug: string): Promise<AgentMemory | null> => {
      const row = await db.select().from(agentMemories)
        .where(and(eq(agentMemories.agentId, agentId), eq(agentMemories.wikiSlug, slug)))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      return row ? rowToMemory(row) : null;
    },

    /**
     * Delete a wiki page by slug. Returns the deleted row or null if it
     * didn't exist or belonged to a different agent.
     */
    wikiRemove: async (agentId: string, slug: string): Promise<AgentMemory | null> => {
      const row = await db
        .delete(agentMemories)
        .where(and(eq(agentMemories.agentId, agentId), eq(agentMemories.wikiSlug, slug)))
        .returning()
        .then((rows) => rows[0] ?? null);
      return row ? rowToMemory(row) : null;
    },

    /**
     * Memory health statistics for an agent — counts and byte totals split
     * by episodic vs wiki. Useful for UI dashboards and for agents that
     * want to self-monitor before they approach the episodic cap.
     */
    stats: async (agentId: string): Promise<{
      episodic: { count: number; bytes: number };
      wiki: { count: number; bytes: number };
      total: { count: number; bytes: number };
    }> => {
      const rows = await db
        .select({
          isWiki: sql<boolean>`(${agentMemories.wikiSlug} IS NOT NULL)`,
          count: sql<number>`count(*)::int`,
          bytes: sql<number>`coalesce(sum(${agentMemories.contentBytes}), 0)::int`,
        })
        .from(agentMemories)
        .where(eq(agentMemories.agentId, agentId))
        .groupBy(sql`(${agentMemories.wikiSlug} IS NOT NULL)`);

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

    /**
     * List all wiki pages for an agent, sorted alphabetically by slug.
     * No count limit — wiki pages are deliberately maintained by the agent
     * and should all be visible in the API. A safety cap of 500 guards
     * against runaway rows from bugs; normal agents will have tens of pages.
     */
    wikiList: async (agentId: string): Promise<AgentMemory[]> => {
      const rows = await db.select().from(agentMemories)
        .where(and(eq(agentMemories.agentId, agentId), isNotNull(agentMemories.wikiSlug), notExpired))
        .orderBy(asc(agentMemories.wikiSlug))
        .limit(500);
      return rows.map(rowToMemory);
    },
  };
}

// maybeLoadMemoriesForInjection lives in ./memory-injection.ts to avoid a
// circular dependency: company-memories.ts already imports MemoryContentTooLargeError
// from this file, so this file cannot import back from company-memories.ts.
