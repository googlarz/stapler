/**
 * Playbook injector — Pillar 8 of the Meta-Flywheel.
 *
 * At agent run-start (alongside memory injection), finds the best-matching
 * playbook for the current task and injects its steps as a synthetic
 * InjectedMemory so the adapter sees them in the system prompt.
 *
 * Matching: jaccard similarity between the normalised issue title / task key
 * and each playbook's taskPatternNorm. Only injects the best match if
 * similarity >= INJECT_THRESHOLD.
 *
 * A/B testing: when a playbook has `abTesting = 1`, 50% of runs get the
 * challenger version (determined by run ID parity). Results feed back
 * through run_scores to update each playbook's win_rate.
 */

import { and, eq } from "drizzle-orm";
import type { Db } from "@stapler/db";
import { playbooks, playbookExperiments } from "@stapler/db";
import type { InjectedMemory } from "@stapler/shared";

const INJECT_THRESHOLD = 0.25;

function normTitle(title: string): string {
  const STOP = new Set(["the","a","an","in","on","at","for","to","of","and","or","is","are","be","was","with","from","that","this","by","as","it"]);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .join(" ");
}

function jaccard(a: string, b: string): number {
  const sa = new Set(a.split(" ").filter(Boolean));
  const sb = new Set(b.split(" ").filter(Boolean));
  if (sa.size === 0 && sb.size === 0) return 0;
  let intersection = 0;
  for (const t of sa) if (sb.has(t)) intersection++;
  return intersection / (sa.size + sb.size - intersection);
}

/**
 * Find and inject a matching playbook for the current run context.
 * Returns an array of InjectedMemory entries (empty if no match).
 */
export async function maybeInjectPlaybook(
  db: Db,
  agentId: string,
  companyId: string,
  context: Record<string, unknown>,
  runId: string,
): Promise<InjectedMemory[]> {
  try {
    const cfg = context.adapterConfig as Record<string, unknown> | undefined;
    if (cfg?.enablePlaybooks !== true) return [];

    const taskTitle =
      (typeof context.issueTitle === "string" ? context.issueTitle : null) ??
      (typeof context.taskKey === "string" ? context.taskKey : null) ??
      (typeof context.task === "string" ? context.task : null);

    if (!taskTitle) return [];

    const norm = normTitle(taskTitle);

    // Fetch active playbooks for this agent
    const agentPlaybooks = await db
      .select()
      .from(playbooks)
      .where(
        and(
          eq(playbooks.agentId, agentId),
          eq(playbooks.companyId, companyId),
          eq(playbooks.active, 1),
        ),
      )
      .limit(20);

    if (agentPlaybooks.length === 0) return [];

    // Find best matching playbook by jaccard similarity
    let bestPlaybook: (typeof agentPlaybooks)[0] | null = null;
    let bestSim = 0;
    for (const p of agentPlaybooks) {
      const sim = jaccard(norm, p.taskPatternNorm);
      if (sim > bestSim) {
        bestSim = sim;
        bestPlaybook = p;
      }
    }

    if (!bestPlaybook || bestSim < INJECT_THRESHOLD) return [];

    // A/B testing: if abTesting = 1, check if there's a running experiment
    let selectedPlaybook = bestPlaybook;
    if (bestPlaybook.abTesting === 1) {
      const experiments = await db
        .select()
        .from(playbookExperiments)
        .where(
          and(
            eq(playbookExperiments.companyId, companyId),
            eq(playbookExperiments.status, "running"),
            eq(playbookExperiments.controlPlaybookId, bestPlaybook.id),
          ),
        )
        .limit(1);

      if (experiments.length > 0) {
        const exp = experiments[0];
        // Deterministic 50/50 split by run ID last character parity
        const lastChar = runId.slice(-1);
        const isChallenger = parseInt(lastChar, 16) % 2 === 1;
        if (isChallenger) {
          const challenger = agentPlaybooks.find((p) => p.id === exp.challengerPlaybookId);
          if (challenger) selectedPlaybook = challenger;
        }
      }
    }

    // Parse steps from JSON
    let steps: string[] = [];
    try {
      const parsed = JSON.parse(selectedPlaybook.steps);
      if (Array.isArray(parsed)) steps = parsed as string[];
    } catch { return []; }

    if (steps.length === 0) return [];

    const content =
      `[Playbook: ${selectedPlaybook.title}]\n` +
      `This playbook was mined from ${selectedPlaybook.sampleSize} successful run${selectedPlaybook.sampleSize !== 1 ? "s" : ""}.\n\n` +
      `Steps:\n` +
      steps.map((s, i) => `${i + 1}. ${s}`).join("\n");

    return [
      {
        id: `playbook:${selectedPlaybook.id}`,
        content,
        tags: ["playbook", "workflow"],
        score: bestSim,
        source: "agent" as const,
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Update a playbook's win rate after a run completes.
 * Called from the heartbeat finalize path for agents with enablePlaybooks.
 * Uses exponential moving average to smooth the win rate.
 */
export async function updatePlaybookWinRate(
  db: Db,
  agentId: string,
  companyId: string,
  runScore: number,
  taskTitle: string,
): Promise<void> {
  try {
    const norm = normTitle(taskTitle);
    const agentPlaybooks = await db
      .select()
      .from(playbooks)
      .where(
        and(
          eq(playbooks.agentId, agentId),
          eq(playbooks.companyId, companyId),
          eq(playbooks.active, 1),
        ),
      )
      .limit(20);

    let bestPlaybook: (typeof agentPlaybooks)[0] | null = null;
    let bestSim = 0;
    for (const p of agentPlaybooks) {
      const sim = jaccard(norm, p.taskPatternNorm);
      if (sim > bestSim) {
        bestSim = sim;
        bestPlaybook = p;
      }
    }

    if (!bestPlaybook || bestSim < INJECT_THRESHOLD) return;

    const prevWinRate = bestPlaybook.winRate ?? runScore;
    const alpha = 0.2; // EMA smoothing factor
    const newWinRate = alpha * runScore + (1 - alpha) * prevWinRate;
    const newSampleSize = bestPlaybook.sampleSize + 1;

    await db
      .update(playbooks)
      .set({
        winRate: newWinRate,
        sampleSize: newSampleSize,
        updatedAt: new Date(),
      })
      .where(eq(playbooks.id, bestPlaybook.id));

    // Update A/B experiment if one is running
    if (bestPlaybook.abTesting === 1) {
      const experiments = await db
        .select()
        .from(playbookExperiments)
        .where(
          and(
            eq(playbookExperiments.companyId, companyId),
            eq(playbookExperiments.status, "running"),
          ),
        )
        .limit(5);

      for (const exp of experiments) {
        const isControl = exp.controlPlaybookId === bestPlaybook.id;
        const isChallenger = exp.challengerPlaybookId === bestPlaybook.id;
        if (!isControl && !isChallenger) continue;

        const isWin = runScore >= 0.7;
        const newTotalRuns = exp.totalRuns + 1;
        const newControlWins = isControl && isWin ? exp.controlWins + 1 : exp.controlWins;
        const newChallengerWins = isChallenger && isWin ? exp.challengerWins + 1 : exp.challengerWins;

        let status = exp.status;
        let concludedAt: Date | undefined;
        if (newTotalRuns >= exp.minRuns) {
          const controlRate = newControlWins / (newTotalRuns / 2);
          const challengerRate = newChallengerWins / (newTotalRuns / 2);
          if (Math.abs(controlRate - challengerRate) > 0.1) {
            status = controlRate > challengerRate ? "control_won" : "challenger_won";
          } else {
            status = "inconclusive";
          }
          concludedAt = new Date();
        }

        await db
          .update(playbookExperiments)
          .set({
            totalRuns: newTotalRuns,
            controlWins: newControlWins,
            challengerWins: newChallengerWins,
            controlWinRate: newControlWins / Math.max(1, newTotalRuns / 2),
            challengerWinRate: newChallengerWins / Math.max(1, newTotalRuns / 2),
            status,
            concludedAt: concludedAt ?? exp.concludedAt,
          })
          .where(eq(playbookExperiments.id, exp.id));
      }
    }
  } catch {
    // Non-critical
  }
}
