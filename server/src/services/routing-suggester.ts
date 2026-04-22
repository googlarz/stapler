/**
 * Routing suggester — Pillar 6 of the Meta-Flywheel.
 *
 * Suggests the best agent to assign a new issue to, based on past routing
 * outcomes. Uses a simple kNN approach: find the N most-similar resolved
 * issues (by title word overlap + labels), compute per-agent win rates,
 * return the top candidate.
 *
 * "Win" = resolved issue with run_score >= WIN_THRESHOLD (0.7).
 *
 * Called fire-and-forget from the issue create route when no assignee is set.
 * Posts a suggestion as a system comment on the issue.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@stapler/db";
import { agents, issues, issueLabels as issueLabelsTable, routingOutcomes } from "@stapler/db";
import { issueService } from "./issues.js";
import { logActivity } from "./activity-log.js";

const WIN_THRESHOLD = 0.7;
const CANDIDATE_SAMPLE = 200;    // recent outcomes to score against
const MIN_WIN_RATE_SAMPLE = 3;   // need ≥3 wins to surface a suggestion

/** Lower-case + strip common stop-words for lightweight similarity */
export function normTitle(title: string): string {
  const STOP = new Set(["the","a","an","in","on","at","for","to","of","and","or","is","are","be","was","with","from","that","this","by","as","it"]);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .join(" ");
}

/** Jaccard similarity between two space-separated token strings */
export function jaccard(a: string, b: string): number {
  const sa = new Set(a.split(" ").filter(Boolean));
  const sb = new Set(b.split(" ").filter(Boolean));
  if (sa.size === 0 && sb.size === 0) return 0;
  let intersection = 0;
  for (const t of sa) if (sb.has(t)) intersection++;
  return intersection / (sa.size + sb.size - intersection);
}

export interface RoutingSuggestion {
  agentId: string;
  agentName: string;
  confidence: number;
  winRate: number;
  sampleSize: number;
  reason: string;
}

/**
 * Persist a routing_outcome row when an issue with an assigned agent is created.
 * Called fire-and-forget from issue create route.
 */
export async function recordRoutingOutcome(
  db: Db,
  issueId: string,
  companyId: string,
  assignedAgentId: string,
  issueTitle: string,
  labelIds: string[] = [],
): Promise<void> {
  try {
    await db.insert(routingOutcomes).values({
      companyId,
      issueId,
      assignedAgentId,
      issueTitleNorm: normTitle(issueTitle),
      issueLabels: labelIds.length > 0 ? JSON.stringify(labelIds) : null,
    });
  } catch {
    // Non-critical — never block issue creation
  }
}

/**
 * Suggest an assignee for a new unassigned issue.
 * Returns null when there's not enough history to make a confident suggestion.
 */
export async function suggestAssignee(
  db: Db,
  issueId: string,
  companyId: string,
  issueTitle: string,
): Promise<RoutingSuggestion | null> {
  const norm = normTitle(issueTitle);

  // Fetch recent resolved outcomes for this company
  const sample = await db
    .select({
      agentId: routingOutcomes.assignedAgentId,
      titleNorm: routingOutcomes.issueTitleNorm,
      runScore: routingOutcomes.runScore,
      resolved: routingOutcomes.resolved,
    })
    .from(routingOutcomes)
    .where(and(eq(routingOutcomes.companyId, companyId), eq(routingOutcomes.resolved, true)))
    .orderBy(desc(routingOutcomes.createdAt))
    .limit(CANDIDATE_SAMPLE);

  if (sample.length === 0) return null;

  // Score each outcome by title similarity and accumulate per-agent stats
  const agentStats = new Map<
    string,
    { totalSim: number; wins: number; total: number }
  >();

  for (const row of sample) {
    const sim = jaccard(norm, row.titleNorm ?? "");
    if (sim < 0.05) continue; // too dissimilar — skip
    const isWin = (row.runScore ?? 0) >= WIN_THRESHOLD;
    const s = agentStats.get(row.agentId) ?? { totalSim: 0, wins: 0, total: 0 };
    s.totalSim += sim;
    if (isWin) s.wins++;
    s.total++;
    agentStats.set(row.agentId, s);
  }

  if (agentStats.size === 0) return null;

  // Pick best agent: maximize wins (min sample), break ties by avg similarity
  let best: { agentId: string; wins: number; winRate: number; total: number; totalSim: number } | null = null;
  for (const [agentId, s] of agentStats) {
    if (s.wins < MIN_WIN_RATE_SAMPLE) continue;
    const winRate = s.wins / s.total;
    if (
      !best ||
      s.wins > best.wins ||
      (s.wins === best.wins && winRate > best.winRate)
    ) {
      best = { agentId, wins: s.wins, winRate, total: s.total, totalSim: s.totalSim };
    }
  }

  if (!best) return null;

  // Fetch agent name
  const agentRows = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(eq(agents.id, best.agentId))
    .limit(1);
  const agent = agentRows[0];
  if (!agent) return null;

  const confidence = Math.min(1, best.wins / 10); // saturates at 10 wins
  return {
    agentId: best.agentId,
    agentName: agent.name,
    confidence,
    winRate: best.winRate,
    sampleSize: best.total,
    reason: `${agent.name} has resolved ${best.wins} similar issue${best.wins !== 1 ? "s" : ""} with a ${Math.round(best.winRate * 100)}% success rate.`,
  };
}

/**
 * Post a routing suggestion as a system comment on an issue.
 * Fire-and-forget — failures are swallowed.
 */
export async function maybePostRoutingSuggestion(
  db: Db,
  issueId: string,
  companyId: string,
  issueTitle: string,
): Promise<void> {
  try {
    const suggestion = await suggestAssignee(db, issueId, companyId, issueTitle);
    if (!suggestion) return;

    const confidence = Math.round(suggestion.confidence * 100);
    const body =
      `💡 **Routing suggestion** (${confidence}% confidence): ` +
      `Assign to **${suggestion.agentName}** — ${suggestion.reason}`;

    await issueService(db).addComment(issueId, body, {});
    await logActivity(db, {
      companyId,
      actorType: "system",
      actorId: "routing-suggester",
      action: "issue.routing_suggested",
      entityType: "issue",
      entityId: issueId,
      details: {
        suggestedAgentId: suggestion.agentId,
        suggestedAgentName: suggestion.agentName,
        confidence: suggestion.confidence,
        winRate: suggestion.winRate,
        sampleSize: suggestion.sampleSize,
      },
    });
  } catch {
    // Non-critical — never block anything
  }
}

/**
 * Mark a routing_outcome as resolved and record the final run score.
 * Called from the heartbeat finalize path when a run succeeds/fails.
 */
export async function finalizeRoutingOutcome(
  db: Db,
  issueId: string,
  runScore: number | null,
): Promise<void> {
  try {
    await db
      .update(routingOutcomes)
      .set({
        resolved: true,
        resolvedAt: new Date(),
        runScore: runScore ?? null,
      })
      .where(
        and(
          eq(routingOutcomes.issueId, issueId),
          eq(routingOutcomes.resolved, false),
        ),
      );
  } catch {
    // Non-critical
  }
}
