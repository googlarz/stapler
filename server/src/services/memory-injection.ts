/**
 * Memory injection for agent run-start.
 *
 * Lives in its own module to avoid a circular dependency:
 *   company-memories.ts → agent-memories.ts (MemoryContentTooLargeError)
 * If maybeLoadMemoriesForInjection lived in agent-memories.ts it would need
 * to import companyMemoryService, creating a cycle. Separate file, no cycle.
 *
 * Three memory tracks are returned together (wiki pages first, then agent
 * episodic, then company episodic):
 *
 * 1. **Agent wiki pages** — always injected, byte-budget controlled, sorted
 *    by updatedAt DESC (most actively-maintained first).
 * 2. **Agent episodic memories** — pg_trgm similarity search, count-bounded,
 *    only when a search query can be assembled from the wakeup context.
 * 3. **Company memories** — pg_trgm similarity search over the company's
 *    shared memory store, giving agents access to team-wide knowledge
 *    (style guides, product decisions, vendor preferences, etc.).
 *
 * Returns an empty array when `agent.config.enableMemoryInjection !== true`.
 */
import type { Db } from "@paperclipai/db";
import type { InjectedMemory } from "@paperclipai/shared";
import { agentMemoryService } from "./agent-memories.js";
import { companyMemoryService } from "./company-memories.js";
import { logActivity } from "./activity-log.js";

/** Default byte budget for agent wiki page injection. ~4K tokens. */
const DEFAULT_WIKI_INJECTION_BUDGET_BYTES = 16_000;

/**
 * Default byte budget for company wiki page injection — separate pool so
 * a company with many large wiki pages cannot crowd out an agent's own
 * compiled knowledge. ~4K tokens, same default as agent wiki.
 */
const DEFAULT_COMPANY_WIKI_INJECTION_BUDGET_BYTES = 16_000;

export async function maybeLoadMemoriesForInjection(
  db: Db,
  agent: { id: string; companyId: string; adapterConfig: unknown },
  context: Record<string, unknown>,
): Promise<InjectedMemory[]> {
  const config =
    typeof agent.adapterConfig === "object" && agent.adapterConfig !== null
      ? (agent.adapterConfig as Record<string, unknown>)
      : {};

  if (config.enableMemoryInjection !== true) return [];

  const svc = agentMemoryService(db);

  // ── Track 1: Agent wiki pages (always injected) ──────────────────────────
  // Sort by updatedAt DESC — most actively-maintained pages first.
  // wikiList() returns alphabetical for API browsing; re-sort here.
  const wikiBudgetBytes =
    typeof config.wikiInjectionBudgetBytes === "number" && config.wikiInjectionBudgetBytes > 0
      ? Math.min(config.wikiInjectionBudgetBytes, 200_000)
      : DEFAULT_WIKI_INJECTION_BUDGET_BYTES;

  const allWikiPages = await svc.wikiList(agent.id);
  const byRecency = [...allWikiPages].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );

  let wikiBudgetLeft = wikiBudgetBytes;
  const wikiInjected: InjectedMemory[] = [];
  for (const page of byRecency) {
    // Skip pages that exceed the remaining budget — don't break; a smaller
    // page later in the list may still fit.
    if (page.contentBytes > wikiBudgetLeft) continue;
    wikiInjected.push({
      id: page.id,
      content: page.content,
      tags: page.tags,
      score: 1,
      wikiSlug: page.wikiSlug ?? undefined,
      source: "agent",
    });
    wikiBudgetLeft -= page.contentBytes;
  }

  // ── Company wiki pages (always injected, independent byte budget) ────────
  // Uses its own budget pool so a company with many large pages cannot
  // crowd out this agent's own wiki pages.
  const companySvc = companyMemoryService(db);
  const companyWikiBudgetBytes =
    typeof config.companyWikiInjectionBudgetBytes === "number" &&
    config.companyWikiInjectionBudgetBytes > 0
      ? Math.min(config.companyWikiInjectionBudgetBytes, 200_000)
      : DEFAULT_COMPANY_WIKI_INJECTION_BUDGET_BYTES;

  const allCompanyWikiPages = await companySvc.wikiList(agent.companyId);
  const companyWikiByRecency = [...allCompanyWikiPages].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  let companyWikiBudgetLeft = companyWikiBudgetBytes;
  for (const page of companyWikiByRecency) {
    if (page.contentBytes > companyWikiBudgetLeft) continue;
    wikiInjected.push({
      id: page.id,
      content: page.content,
      tags: page.tags,
      score: 1,
      wikiSlug: page.wikiSlug ?? undefined,
      source: "company",
    });
    companyWikiBudgetLeft -= page.contentBytes;
  }

  // ── Build search query from wakeup context ───────────────────────────────
  const limit =
    typeof config.memoryInjectionLimit === "number" && config.memoryInjectionLimit > 0
      ? Math.min(config.memoryInjectionLimit, 20)
      : 5;

  const queryParts: string[] = [];
  if (typeof context.wakeReason === "string" && context.wakeReason.trim()) {
    queryParts.push(context.wakeReason.trim());
  }
  // Prefer structured wake payload issue title (common heartbeat path),
  // then flat top-level fields for other callers.
  const wakePayload = context.paperclipWake;
  const wakeIssueObj =
    wakePayload !== null &&
    typeof wakePayload === "object" &&
    typeof (wakePayload as Record<string, unknown>).issue === "object" &&
    (wakePayload as Record<string, unknown>).issue !== null
      ? ((wakePayload as Record<string, unknown>).issue as Record<string, unknown>)
      : null;
  const wakeIssueTitle =
    typeof wakeIssueObj?.title === "string" ? wakeIssueObj.title : undefined;
  if (typeof wakeIssueTitle === "string" && wakeIssueTitle.trim()) {
    queryParts.push(wakeIssueTitle.trim());
  } else if (typeof context.taskTitle === "string" && context.taskTitle.trim()) {
    queryParts.push(context.taskTitle.trim());
  } else if (typeof context.issueTitle === "string" && context.issueTitle.trim()) {
    queryParts.push(context.issueTitle.trim());
  }

  // pg_trgm similarity degrades on very long queries (O(n) trigrams).
  // Cap to 200 chars at a word boundary where possible.
  const rawQ = queryParts.join(" ").trim();
  const MAX_QUERY_CHARS = 200;
  const q =
    rawQ.length > MAX_QUERY_CHARS
      ? rawQ.slice(0, MAX_QUERY_CHARS).replace(/\s\S*$/, "").trim() ||
        rawQ.slice(0, MAX_QUERY_CHARS)
      : rawQ;

  if (!q) {
    // No search context — return wiki pages only.
    return wikiInjected;
  }

  // ── Track 2: Agent episodic memories (similarity search) ─────────────────
  // excludeWiki: true — wiki pages are already in the result above.
  const agentSearchResults = await svc.search({
    agentId: agent.id,
    q,
    limit,
    excludeWiki: true,
  });
  const agentSearchInjected: InjectedMemory[] = agentSearchResults.map((r) => ({
    id: r.id,
    content: r.content,
    tags: r.tags,
    score: r.score,
    source: "agent" as const,
  }));

  // ── Track 3: Company episodic memories (shared team knowledge) ───────────
  // companySvc already instantiated above for wiki pages.
  const companyEpisodicResults = await companySvc.search({
    companyId: agent.companyId,
    q,
    limit,
  });
  const companyEpisodicInjected: InjectedMemory[] = companyEpisodicResults
    .filter((r) => !r.wikiSlug) // wiki pages already injected above
    .map((r) => ({
      id: r.id,
      content: r.content,
      tags: r.tags,
      score: r.score,
      source: "company" as const,
    }));

  const result = [...wikiInjected, ...agentSearchInjected, ...companyEpisodicInjected];

  // ── Injection audit log (fire-and-forget) ────────────────────────────────
  // Record what was injected so operators can inspect "what context did this
  // agent have at wakeup?" via the activity log. Runs non-blocking so a log
  // write failure never delays agent wakeup.
  if (result.length > 0) {
    const runId = typeof context.runId === "string" ? context.runId : undefined;
    void logActivity(db, {
      companyId: agent.companyId,
      actorType: "system",
      actorId: agent.id,
      agentId: agent.id,
      runId,
      action: "memory.injected",
      entityType: "agent",
      entityId: agent.id,
      details: {
        total: result.length,
        agentWiki: wikiInjected.filter((m) => m.source === "agent").length,
        companyWiki: wikiInjected.filter((m) => m.source === "company").length,
        agentEpisodic: agentSearchInjected.length,
        companyEpisodic: companyEpisodicInjected.length,
        query: q || null,
      },
    }).catch(() => {
      // Swallow — audit logging must not block or crash agent wakeup.
    });
  }

  return result;
}
