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
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentMemories } from "@paperclipai/db";
import type {
  AgentMemory,
  AgentMemorySearchResult,
  AgentMemorySaveResult,
  InjectedMemory,
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
    wikiSlug: row.wikiSlug ?? null,
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
          })
          .onConflictDoUpdate({
            target: [agentMemories.agentId, agentMemories.contentHash],
            set: { updatedAt: sql`now()` },
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

      const [row] = await db
        .insert(agentMemories)
        .values({ companyId: input.companyId, agentId: input.agentId, content: trimmed, contentHash, contentBytes, tags, wikiSlug: slug, createdInRunId: input.runId ?? null })
        .onConflictDoUpdate({
          target: [agentMemories.agentId, agentMemories.wikiSlug],
          targetWhere: sql`${agentMemories.wikiSlug} IS NOT NULL`,
          set: { content: trimmed, contentHash, contentBytes, tags, updatedAt: sql`now()` },
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
     * List all wiki pages for an agent, sorted alphabetically by slug.
     * No count limit — wiki pages are deliberately maintained by the agent
     * and should all be visible in the API. A safety cap of 500 guards
     * against runaway rows from bugs; normal agents will have tens of pages.
     */
    wikiList: async (agentId: string): Promise<AgentMemory[]> => {
      const rows = await db.select().from(agentMemories)
        .where(and(eq(agentMemories.agentId, agentId), isNotNull(agentMemories.wikiSlug)))
        .orderBy(asc(agentMemories.wikiSlug))
        .limit(500);
      return rows.map(rowToMemory);
    },
  };
}

/**
 * Default byte budget for wiki page injection. ~4K tokens — fits comfortably
 * in all adapters including small Ollama models with 8K context windows.
 * Override per-agent via `agent.config.wikiInjectionBudgetBytes`.
 */
const DEFAULT_WIKI_INJECTION_BUDGET_BYTES = 16_000;

/**
 * Load memories for injection into the adapter's prompt at run-start.
 *
 * Two independent memory tracks are loaded and returned together:
 *
 * 1. **Wiki pages** (compiled knowledge) — always injected, regardless of
 *    whether there is a search query. Pages are sorted by `updatedAt DESC`
 *    so the most actively-maintained ones arrive first. A byte budget
 *    (default 16 KB, configurable via `agent.config.wikiInjectionBudgetBytes`)
 *    prevents context blowout on long-running agents with many pages.
 *    Pages that exceed the remaining budget are skipped rather than
 *    truncating — a smaller page later in the list may still fit.
 *
 * 2. **Episodic memories** (similarity search) — only fetched when a search
 *    query can be assembled from the wakeup context. Count is bounded by
 *    `agent.config.memoryInjectionLimit` (default 5, max 20).
 *
 * Returns an empty array when `agent.config.enableMemoryInjection !== true`.
 */
export async function maybeLoadMemoriesForInjection(
  db: Db,
  agent: { id: string; adapterConfig: unknown },
  context: Record<string, unknown>,
): Promise<InjectedMemory[]> {
  const config = typeof agent.adapterConfig === "object" && agent.adapterConfig !== null
    ? (agent.adapterConfig as Record<string, unknown>)
    : {};

  if (config.enableMemoryInjection !== true) return [];

  const svc = agentMemoryService(db);

  // ── Track 1: Wiki pages ──────────────────────────────────────────────────
  // Always injected. Sort by updatedAt DESC so the most actively-maintained
  // pages (which the agent is currently working on) arrive first. wikiList()
  // returns alphabetical for API browsing; re-sort here for injection priority.
  const wikiBudgetBytes =
    typeof config.wikiInjectionBudgetBytes === "number" && config.wikiInjectionBudgetBytes > 0
      ? Math.min(config.wikiInjectionBudgetBytes, 200_000)
      : DEFAULT_WIKI_INJECTION_BUDGET_BYTES;

  const allWikiPages = await svc.wikiList(agent.id);
  const byRecency = [...allWikiPages].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  let wikiBudgetLeft = wikiBudgetBytes;
  const wikiInjected: InjectedMemory[] = [];
  for (const page of byRecency) {
    // Skip pages that don't fit but keep going — a smaller page may still fit.
    if (page.contentBytes > wikiBudgetLeft) continue;
    wikiInjected.push({
      id: page.id,
      content: page.content,
      tags: page.tags,
      score: 1,
      wikiSlug: page.wikiSlug ?? undefined,
    });
    wikiBudgetLeft -= page.contentBytes;
  }

  // ── Track 2: Episodic memories (similarity search) ───────────────────────
  // Only fetched when we have a non-empty query. Wiki pages above are already
  // in the result; we return them even if no query is available.
  const limit = typeof config.memoryInjectionLimit === "number" && config.memoryInjectionLimit > 0
    ? Math.min(config.memoryInjectionLimit, 20)
    : 5;

  const queryParts: string[] = [];
  if (typeof context.wakeReason === "string" && context.wakeReason.trim()) {
    queryParts.push(context.wakeReason.trim());
  }
  // Prefer structured wake payload issue title (the common heartbeat path),
  // then fall back to flat top-level fields for other callers.
  const wakePayload = context.paperclipWake;
  // Narrow the issue field safely: check it is a non-null object before
  // accessing .title, avoiding the unsafe double-cast pattern.
  const wakeIssueObj =
    wakePayload !== null &&
    typeof wakePayload === "object" &&
    typeof (wakePayload as Record<string, unknown>).issue === "object" &&
    (wakePayload as Record<string, unknown>).issue !== null
      ? (wakePayload as Record<string, unknown>).issue as Record<string, unknown>
      : null;
  const wakeIssueTitle = typeof wakeIssueObj?.title === "string" ? wakeIssueObj.title : undefined;
  if (typeof wakeIssueTitle === "string" && wakeIssueTitle.trim()) {
    queryParts.push(wakeIssueTitle.trim());
  } else if (typeof context.taskTitle === "string" && context.taskTitle.trim()) {
    queryParts.push(context.taskTitle.trim());
  } else if (typeof context.issueTitle === "string" && context.issueTitle.trim()) {
    queryParts.push(context.issueTitle.trim());
  }

  // pg_trgm similarity degrades on very long query strings (O(n) trigrams).
  // Cap to 200 chars — enough for a wake reason + issue title, trimmed at a
  // word boundary where possible so we don't cut in the middle of a keyword.
  const rawQ = queryParts.join(" ").trim();
  const MAX_QUERY_CHARS = 200;
  const q = rawQ.length > MAX_QUERY_CHARS
    ? rawQ.slice(0, MAX_QUERY_CHARS).replace(/\s\S*$/, "").trim() || rawQ.slice(0, MAX_QUERY_CHARS)
    : rawQ;

  if (!q) {
    // No search context available — return wiki pages only.
    return wikiInjected;
  }

  const searchResults = await svc.search({ agentId: agent.id, q, limit });
  const searchInjected: InjectedMemory[] = searchResults
    .filter((r) => !r.wikiSlug)
    .map((r) => ({ id: r.id, content: r.content, tags: r.tags, score: r.score }));

  return [...wikiInjected, ...searchInjected];
}
