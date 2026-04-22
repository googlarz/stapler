/**
 * Continuous run scoring — Pillar 1 of the Quality Flywheel.
 *
 * Every successful heartbeat run (when `autoScoreRuns: true` is set in the
 * agent's adapterConfig) is judged by the LLM judge against a generic
 * quality rubric and the score is persisted in `run_scores`.
 *
 * Rubric source priority (future pillars will extend this):
 *   1. Issue acceptance criteria (if the run is tied to an issue)
 *   2. Goal acceptance criteria (if the run is tied to a goal)
 *   3. Generic quality rubric (fallback)
 *
 * Today only (3) is wired; (1) and (2) are stubbed for later pillars.
 *
 * Fire-and-forget from the heartbeat finalize path — callers use
 * `void maybeScoreRun(...).catch(...)` so judge failures never crash runs.
 */

import type { Db } from "@stapler/db";
import { agents, runScores } from "@stapler/db";
import { judgeOutput } from "./eval-judge.js";
import { maybeRunPostMortemOnLowScore } from "./post-mortem.js";

const GENERIC_RUBRIC_VERSION = "generic-v1";

const GENERIC_CRITERIA = `Evaluate whether the agent produced a useful, correct, and complete output for its task.

Consider:
- Did the output address the task, not wander off?
- Are claims concrete and accurate, not hand-waving?
- Did the agent actually do the work (ran commands, edited files, produced an artifact) vs. only describing what it would do?
- Is the output free of obvious errors, hallucinated files, or unresolved tool failures?

Score 10 = clearly useful, correct, complete output that advances the task.
Score 5 = partial or mixed quality — some progress but incomplete or shaky.
Score 0 = no useful output, or output is wrong/incoherent.`;

/** Which judge model actually produced the score (best-effort tag for drift tracking). */
function inferJudgeModel(): string {
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.STAPLER_OLLAMA_HOST) {
    return process.env.STAPLER_OLLAMA_JUDGE_MODEL ?? "llama3.2";
  }
  return "heuristic";
}

export interface ScoreRunInput {
  runId: string;
  agentId: string;
  companyId: string;
  stdoutExcerpt: string;
}

/**
 * Score a completed heartbeat run against the generic quality rubric
 * and persist the result. Idempotent-ish: callers should only invoke
 * once per run (at finalize time). Returns the row or null on error.
 */
export async function scoreRun(
  db: Db,
  input: ScoreRunInput,
): Promise<typeof runScores.$inferSelect | null> {
  try {
    const judgement = await judgeOutput(GENERIC_CRITERIA, input.stdoutExcerpt);
    const [row] = await db
      .insert(runScores)
      .values({
        runId: input.runId,
        agentId: input.agentId,
        companyId: input.companyId,
        score: judgement.score,
        rubricVersion: GENERIC_RUBRIC_VERSION,
        rubricSource: "generic",
        reasoning: judgement.reasoning,
        judgeModel: inferJudgeModel(),
      })
      .returning();

    // Pillar 3 — Failure → Rule pipeline. Fire a post-mortem for low-scoring runs.
    if (row && judgement.score < 0.5) {
      void maybeRunPostMortemOnLowScore(db, input.runId, judgement.score).catch(() => {
        // Post-mortem failures must never crash the scorer.
      });
    }

    return row ?? null;
  } catch (err) {
    console.warn(`[run-scorer] failed to score run ${input.runId}:`, err);
    return null;
  }
}

/**
 * Decide whether this agent's runs should be auto-scored, then score.
 * Opt-in via `autoScoreRuns: true` in the agent's adapterConfig.
 * Returns null when auto-scoring is disabled or no stdout was captured.
 */
export async function maybeScoreRun(
  db: Db,
  agent: typeof agents.$inferSelect,
  runId: string,
  stdoutExcerpt: string,
): Promise<typeof runScores.$inferSelect | null> {
  if (!stdoutExcerpt || stdoutExcerpt.trim().length === 0) return null;
  const cfg = agent.adapterConfig ?? {};
  if (cfg["autoScoreRuns"] !== true) return null;
  return scoreRun(db, {
    runId,
    agentId: agent.id,
    companyId: agent.companyId,
    stdoutExcerpt,
  });
}
