/**
 * Playbook miner — Pillar 8 of the Meta-Flywheel.
 *
 * Mines high-scoring runs to extract per-agent playbooks.
 * Runs periodically (wired via eval-scheduler cadence) for each agent
 * that has `enablePlaybooks: true` in its adapterConfig.
 *
 * Algorithm:
 *  1. Fetch recent high-scoring runs (score >= MINE_THRESHOLD) for the agent.
 *  2. Group runs by normalised issue title (task pattern clustering).
 *  3. For clusters with >= MIN_CLUSTER_SIZE runs, call the LLM to extract
 *     a step-by-step playbook from the aggregated stdout excerpts.
 *  4. Upsert the playbook (create new version if similar playbook exists).
 *
 * Called fire-and-forget from eval-scheduler. Failures are swallowed.
 */

import { and, avg, desc, eq, gte } from "drizzle-orm";
import type { Db } from "@stapler/db";
import { agents, heartbeatRuns, playbooks, runScores } from "@stapler/db";

const MINE_THRESHOLD = 0.75;    // minimum score to include in mining
const MIN_CLUSTER_SIZE = 3;     // minimum runs to form a playbook
const WINDOW_DAYS = 60;         // look back 60 days

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OLLAMA_HOST = "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL = "llama3.2";

export function normTitle(title: string): string {
  const STOP = new Set(["the","a","an","in","on","at","for","to","of","and","or","is","are","be","was","with","from","that","this","by","as","it"]);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .join(" ");
}

export function jaccard(a: string, b: string): number {
  const sa = new Set(a.split(" ").filter(Boolean));
  const sb = new Set(b.split(" ").filter(Boolean));
  if (sa.size === 0 && sb.size === 0) return 0;
  let intersection = 0;
  for (const t of sa) if (sb.has(t)) intersection++;
  return intersection / (sa.size + sb.size - intersection);
}

/** Cluster run titles into groups by jaccard similarity (greedy) */
export function clusterTitles(
  items: Array<{ norm: string; excerpt: string; score: number }>,
  threshold = 0.3,
): Array<Array<{ norm: string; excerpt: string; score: number }>> {
  const clusters: Array<Array<{ norm: string; excerpt: string; score: number }>> = [];
  for (const item of items) {
    let placed = false;
    for (const cluster of clusters) {
      const centroid = cluster[0].norm;
      if (jaccard(item.norm, centroid) >= threshold) {
        cluster.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([item]);
  }
  return clusters;
}

async function extractPlaybookSteps(
  taskPattern: string,
  excerpts: string[],
): Promise<string[] | null> {
  const combinedExcerpt = excerpts.slice(0, 5).map((e, i) => `Run ${i + 1}:\n${e.slice(0, 500)}`).join("\n\n---\n\n");
  const prompt = `You are analysing successful agent runs for the task pattern: "${taskPattern}".

Here are ${excerpts.length} run excerpts:
${combinedExcerpt}

Extract a reusable step-by-step playbook that captures the key actions common across these successful runs.

Rules:
- 3–7 concrete steps, starting with a verb
- Each step ≤ 80 characters
- Focus on the approach, not the specifics
- Return ONLY valid JSON, no markdown

Format: {"steps": ["step 1", "step 2", ...]}`;

  // Try OpenAI
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    try {
      const res = await fetch(OPENAI_CHAT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 256,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = data?.choices?.[0]?.message?.content?.trim() ?? "";
        const parsed = JSON.parse(content) as { steps?: unknown };
        if (Array.isArray(parsed.steps) && parsed.steps.length >= 2) {
          return (parsed.steps as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 7);
        }
      }
    } catch { /* fall through */ }
  }

  // Try Ollama
  const host = process.env.STAPLER_OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST;
  const model = process.env.STAPLER_OLLAMA_JUDGE_MODEL ?? DEFAULT_OLLAMA_MODEL;
  try {
    const res = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        options: { temperature: 0.3 },
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { message?: { content?: string } };
      const content = data?.message?.content?.trim() ?? "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { steps?: unknown };
        if (Array.isArray(parsed.steps) && parsed.steps.length >= 2) {
          return (parsed.steps as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 7);
        }
      }
    }
  } catch { /* fall through */ }

  return null;
}

/**
 * Mine playbooks for a single agent. Called from the eval-scheduler.
 * Returns the number of playbooks created or updated.
 */
export async function minePlaybooksForAgent(
  db: Db,
  agentId: string,
  companyId: string,
): Promise<number> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000);

  // Fetch high-scoring runs with their stdout excerpts
  const rows = await db
    .select({
      runId: runScores.runId,
      score: runScores.score,
      stdoutExcerpt: heartbeatRuns.stdoutExcerpt,
    })
    .from(runScores)
    .innerJoin(heartbeatRuns, eq(heartbeatRuns.id, runScores.runId))
    .where(
      and(
        eq(runScores.agentId, agentId),
        eq(runScores.companyId, companyId),
        gte(runScores.judgedAt, since),
        gte(runScores.score, MINE_THRESHOLD),
      ),
    )
    .orderBy(desc(runScores.score))
    .limit(100);

  if (rows.length < MIN_CLUSTER_SIZE) return 0;

  // Map run IDs to their issue titles via contextSnapshot
  const runIds = rows.map((r) => r.runId);
  const runContexts = await db
    .select({ id: heartbeatRuns.id, contextSnapshot: heartbeatRuns.contextSnapshot })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.agentId, agentId)));

  const contextByRunId = new Map(runContexts.map((r) => [r.id, r.contextSnapshot as Record<string, unknown> | null]));

  const items = rows
    .map((row) => {
      const ctx = contextByRunId.get(row.runId);
      const title = typeof ctx?.issueTitle === "string" ? ctx.issueTitle
        : typeof ctx?.taskKey === "string" ? ctx.taskKey
          : "";
      return {
        norm: normTitle(title || "general task"),
        excerpt: row.stdoutExcerpt ?? "",
        score: row.score,
      };
    })
    .filter((i) => i.excerpt.length > 50);

  if (items.length < MIN_CLUSTER_SIZE) return 0;

  const clusters = clusterTitles(items);
  let upserted = 0;

  for (const cluster of clusters) {
    if (cluster.length < MIN_CLUSTER_SIZE) continue;

    const taskPattern = cluster[0].norm;
    const excerpts = cluster.map((c) => c.excerpt);
    const avgScore = cluster.reduce((s, c) => s + c.score, 0) / cluster.length;

    const steps = await extractPlaybookSteps(taskPattern, excerpts);
    if (!steps) continue;

    const stepsJson = JSON.stringify(steps);

    // Check for existing playbook with similar pattern
    const existingRows = await db
      .select()
      .from(playbooks)
      .where(and(eq(playbooks.agentId, agentId), eq(playbooks.companyId, companyId)))
      .limit(50);

    const existing = existingRows.find(
      (p) => jaccard(p.taskPatternNorm, taskPattern) >= 0.4,
    );

    if (existing) {
      // Update existing playbook (bump version + steps)
      await db
        .update(playbooks)
        .set({
          steps: stepsJson,
          version: existing.version + 1,
          sampleSize: existing.sampleSize + cluster.length,
          winRate: avgScore,
          updatedAt: new Date(),
        })
        .where(eq(playbooks.id, existing.id));
    } else {
      // Create new playbook
      const titleWords = taskPattern.split(" ").slice(0, 4).join(" ");
      await db
        .insert(playbooks)
        .values({
          companyId,
          agentId,
          title: `Playbook: ${titleWords}`,
          taskPatternNorm: taskPattern,
          steps: stepsJson,
          winRate: avgScore,
          sampleSize: cluster.length,
        });
    }
    upserted++;
  }

  return upserted;
}

/**
 * Run playbook mining for all agents with `enablePlaybooks: true`.
 * Called from eval-scheduler nightly job (or on-demand).
 */
export async function runPlaybookMiningForCompany(
  db: Db,
  companyId: string,
): Promise<{ agentId: string; playbooksUpserted: number }[]> {
  const agentRows = await db
    .select({ id: agents.id, adapterConfig: agents.adapterConfig })
    .from(agents)
    .where(eq(agents.companyId, companyId));

  const results: { agentId: string; playbooksUpserted: number }[] = [];
  for (const agent of agentRows) {
    const cfg = (agent.adapterConfig ?? {}) as Record<string, unknown>;
    if (cfg.enablePlaybooks !== true) continue;
    try {
      const n = await minePlaybooksForAgent(db, agent.id, companyId);
      if (n > 0) results.push({ agentId: agent.id, playbooksUpserted: n });
    } catch { /* non-critical */ }
  }
  return results;
}
