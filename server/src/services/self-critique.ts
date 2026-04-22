/**
 * Self-critique gate — Pillar 2 of the Quality Flywheel.
 *
 * Before a run finalises as "succeeded", the agent's output is scored
 * against a self-critique rubric. If the score falls below the agent's
 * `selfCritiqueThreshold`, the run is held as "needs_review" instead.
 *
 * This is intentionally SYNCHRONOUS in the finalize path (unlike
 * continuous scoring, which is fire-and-forget). We need the result
 * before writing the terminal run status.
 *
 * Provider cascade mirrors eval-judge.ts:
 *   OpenAI (gpt-4o-mini) → Ollama → heuristic fallback (pass = output is
 *   non-empty; conservative so we don't block runs without a judge).
 */

import { judgeOutput } from "./eval-judge.js";
import type { agents } from "@stapler/db";

export interface SelfCritiqueResult {
  score: number;       // 0.0–1.0
  reasoning: string;
  /** true when score >= threshold (run can proceed to succeeded) */
  passed: boolean;
}

const SELF_CRITIQUE_CRITERIA = `You are a strict quality gatekeeper reviewing an agent's run output.

Assess whether this output is ready to deliver to the requester as-is without human review.

A run PASSES (score ≥ 5) when it:
- Directly addresses the assigned task with concrete actions taken
- Produces correct, self-consistent results (no hallucinated file names or wrong API calls)
- Shows real work was done (files edited, commands run, artifacts produced)
- Does not leave the task in a broken or worse state than before

A run FAILS (score < 5) when it:
- Only describes what it would do without doing it
- Contains obvious factual errors or unresolved failures
- Leaves the system in an inconsistent state
- Is empty or minimal without meaningful progress

Be strict. Marginal output should not auto-ship.`;

/**
 * Run the self-critique check against the agent's output excerpt.
 * This is a synchronous await in the finalize path — keep provider latency in mind.
 */
export async function selfCritiqueRun(
  stdoutExcerpt: string,
): Promise<SelfCritiqueResult> {
  // judgeOutput is the same LLM-judge we use everywhere, with a different criteria string.
  const result = await judgeOutput(SELF_CRITIQUE_CRITERIA, stdoutExcerpt);
  return {
    score: result.score,
    reasoning: result.reasoning,
    passed: result.score >= 0.5, // default neutral cutoff; caller compares against threshold
  };
}

/**
 * Gate a succeeded run through self-critique.
 *
 * Returns the effective final DB status to write:
 *   "succeeded"     – passed critique (or gate is disabled)
 *   "needs_review"  – failed critique; human must approve before shipping
 *
 * Also returns the SelfCritiqueResult for logging, or null when the gate is
 * disabled.
 */
export async function maybeSelfCritique(
  agent: typeof agents.$inferSelect,
  stdoutExcerpt: string,
): Promise<{
  status: "succeeded" | "needs_review";
  critique: SelfCritiqueResult | null;
}> {
  const threshold = agent.selfCritiqueThreshold;
  if (threshold == null || !stdoutExcerpt || stdoutExcerpt.trim().length === 0) {
    return { status: "succeeded", critique: null };
  }

  const critique = await selfCritiqueRun(stdoutExcerpt);
  const passed = critique.score >= threshold;
  return {
    status: passed ? "succeeded" : "needs_review",
    critique,
  };
}
