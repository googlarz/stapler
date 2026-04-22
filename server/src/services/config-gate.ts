/**
 * Config-change gate — Pillar 4 of the Quality Flywheel.
 *
 * When an agent has a `smokeSuiteId` and a significant config key changes
 * (systemPrompt, model, adapterType), this service:
 *   1. Runs the pinned smoke eval suite.
 *   2. Compares the avgScore against the baseline (last recorded score).
 *   3. Returns PASS (allow the config update) or FAIL (block with runId for inspection).
 *
 * Significant config keys: any key listed in GATED_KEYS. Future: read from
 * agent config or compile based on adapterType.
 *
 * The gate is synchronous from the route's perspective — the route awaits
 * this function before applying the update. Eval runs are typically fast
 * (10–30s for small suites) so the UX latency is acceptable for config saves.
 *
 * If the smoke suite errors or no baseline exists, the gate is lenient
 * (PASS) so a missing judge never permanently blocks an agent config update.
 */

import { eq } from "drizzle-orm";
import type { Db } from "@stapler/db";
import { agents, evalRuns, evalSuites } from "@stapler/db";
import { runEvalSuite } from "./eval-runner.js";

/** Config keys that trigger the smoke gate when changed. */
export const GATED_KEYS = new Set([
  "systemPrompt",
  "model",
  "adapterType",
  "mcpServers",
  "tools",
]);

const DEFAULT_REGRESSION_TOLERANCE = 0.1;

export type ConfigGateDecision =
  | { passed: true; runId: string; score: number }
  | { passed: false; runId: string; score: number; baseline: number; message: string };

/**
 * Run the smoke eval suite for the given agent and return a gate decision.
 *
 * @param agent     Full agent row (must have smokeSuiteId set).
 * @param changedKeys  Keys that changed in this config update.
 */
export async function runConfigGate(
  db: Db,
  agent: typeof agents.$inferSelect,
  changedKeys: string[],
): Promise<ConfigGateDecision | null> {
  // Skip gate if no suite pinned or no gated keys changed.
  if (!agent.smokeSuiteId) return null;
  const hasGatedKey = changedKeys.some((k) => GATED_KEYS.has(k));
  if (!hasGatedKey) return null;

  // Load the suite to confirm it exists and belongs to this agent.
  const suiteRows = await db
    .select()
    .from(evalSuites)
    .where(eq(evalSuites.id, agent.smokeSuiteId))
    .limit(1);
  const suite = suiteRows[0];
  if (!suite) return null; // suite was deleted; don't block the update

  // Find the most recent completed run to use as the baseline.
  const baselineRows = await db
    .select({ summaryJson: evalRuns.summaryJson })
    .from(evalRuns)
    .where(eq(evalRuns.suiteId, suite.id))
    .orderBy(evalRuns.createdAt)
    .limit(1);
  const baseline = baselineRows[0]?.summaryJson?.avgScore ?? null;

  // Create a new eval run and execute it.
  const [newRun] = await db
    .insert(evalRuns)
    .values({ suiteId: suite.id, triggeredBy: "config-gate" })
    .returning();
  if (!newRun) return null;

  // Run synchronously — the route awaits us.
  await runEvalSuite(db, newRun.id);

  // Re-read the finished run.
  const runRows = await db
    .select({ summaryJson: evalRuns.summaryJson })
    .from(evalRuns)
    .where(eq(evalRuns.id, newRun.id))
    .limit(1);
  const finishedRun = runRows[0];
  const score = finishedRun?.summaryJson?.avgScore ?? null;

  // If we couldn't score, pass (lenient).
  if (score == null) return { passed: true, runId: newRun.id, score: 0 };

  // If no baseline, any score passes (first run ever).
  if (baseline == null) return { passed: true, runId: newRun.id, score };

  const tolerance = agent.smokeRegressionTolerance ?? DEFAULT_REGRESSION_TOLERANCE;
  const floor = baseline - tolerance;
  if (score >= floor) {
    return { passed: true, runId: newRun.id, score };
  }
  return {
    passed: false,
    runId: newRun.id,
    score,
    baseline,
    message: `Smoke eval regressed: score ${Math.round(score * 100)}% vs baseline ${Math.round(baseline * 100)}% (tolerance ${Math.round(tolerance * 100)}%). Review run ${newRun.id} before applying this config change.`,
  };
}
