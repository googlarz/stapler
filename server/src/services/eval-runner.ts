/**
 * Eval runner service.
 *
 * Orchestrates the execution of an eval suite:
 *   1. Creates an eval_run record (status: "running").
 *   2. For each case in the suite:
 *      a. Creates an eval_case_result (status: "pending").
 *      b. Triggers agent wakeup with the case's inputJson as context.
 *      c. Polls until the heartbeat run finishes (timeout: 10 min).
 *      d. Scores the output with the LLM judge.
 *      e. Updates eval_case_result with score + judge output.
 *   3. Computes the suite summary and updates eval_run (status: "done").
 *
 * Cases run sequentially to avoid overloading a single agent with
 * concurrent wakeups. Future: parallelise across agents.
 *
 * This function is fire-and-forget from the HTTP layer — callers get
 * the run ID immediately and poll via GET /eval-runs/:id.
 */

import { and, eq } from "drizzle-orm";
import type { Db } from "@stapler/db";
import { evalCaseResults, evalCases, evalRuns, evalSuites, heartbeatRuns } from "@stapler/db";
import { heartbeatService } from "./heartbeat.js";
import { judgeOutput } from "./eval-judge.js";

/** Max time to wait for a single heartbeat run to complete (ms). */
const RUN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const POLL_INTERVAL_MS = 5_000;

async function waitForRun(
  db: Db,
  runId: string,
): Promise<{ status: string; stdoutExcerpt: string | null } | null> {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const rows = await db
      .select({ status: heartbeatRuns.status, stdoutExcerpt: heartbeatRuns.stdoutExcerpt })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (
      row.status === "succeeded" ||
      row.status === "failed" ||
      row.status === "cancelled" ||
      row.status === "timed_out" ||
      row.status === "needs_review"  // Pillar 2: self-critique gate; treat as terminal
    ) {
      return row;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return null; // timed out
}

export async function runEvalSuite(db: Db, runId: string): Promise<void> {
  const heartbeat = heartbeatService(db);

  // Load the run and suite
  const runRows = await db
    .select()
    .from(evalRuns)
    .where(eq(evalRuns.id, runId))
    .limit(1);
  const run = runRows[0];
  if (!run) {
    console.error(`[eval-runner] eval_run ${runId} not found`);
    return;
  }

  const suiteRows = await db
    .select()
    .from(evalSuites)
    .where(eq(evalSuites.id, run.suiteId))
    .limit(1);
  const suite = suiteRows[0];
  if (!suite) {
    console.error(`[eval-runner] eval_suite ${run.suiteId} not found`);
    return;
  }

  const cases = await db
    .select()
    .from(evalCases)
    .where(eq(evalCases.suiteId, suite.id));

  // Mark run as running
  await db
    .update(evalRuns)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(evalRuns.id, runId));

  const counts = { passed: 0, failed: 0, errors: 0, totalScore: 0 };

  for (const evalCase of cases) {
    // Create case result placeholder
    const [caseResult] = await db
      .insert(evalCaseResults)
      .values({
        runId,
        caseId: evalCase.id,
        status: "running",
      })
      .returning();

    if (!caseResult) continue;

    try {
      // Trigger wakeup with the case's input as context
      const inputCtx = (evalCase.inputJson as Record<string, unknown>) ?? {};
      const wakeReason =
        typeof inputCtx.wakeReason === "string"
          ? inputCtx.wakeReason
          : typeof inputCtx.task === "string"
            ? inputCtx.task
            : `eval run ${runId}`;

      const heartbeatRun = await heartbeat.wakeup(suite.agentId, {
        source: "on_demand",
        triggerDetail: "system",
        reason: `[eval] ${wakeReason}`,
        contextSnapshot: {
          ...inputCtx,
          evalRunId: runId,
          evalCaseId: evalCase.id,
          evalCaseResultId: caseResult.id,
          invocationSource: "eval",
        },
        requestedByActorType: "system",
      });

      if (!heartbeatRun) {
        // Agent busy / skipped — mark as error
        await db
          .update(evalCaseResults)
          .set({ status: "error", judgeOutput: "Agent wakeup was skipped (busy or paused).", updatedAt: new Date() })
          .where(eq(evalCaseResults.id, caseResult.id));
        counts.errors++;
        continue;
      }

      // Record the heartbeat run ID
      await db
        .update(evalCaseResults)
        .set({ heartbeatRunId: heartbeatRun.id })
        .where(eq(evalCaseResults.id, caseResult.id));

      // Poll for completion
      const finished = await waitForRun(db, heartbeatRun.id);
      const stdoutExcerpt = finished?.stdoutExcerpt ?? "";

      if (!finished || finished.status !== "succeeded") {
        await db
          .update(evalCaseResults)
          .set({
            status: "error",
            stdoutExcerpt,
            judgeOutput:
              !finished
                ? "Timed out waiting for agent run to complete."
                : `Agent run ended with status: ${finished.status}`,
            updatedAt: new Date(),
          })
          .where(eq(evalCaseResults.id, caseResult.id));
        counts.errors++;
        continue;
      }

      // Judge the output
      const judgeResult = await judgeOutput(evalCase.criteria, stdoutExcerpt);
      const passed = judgeResult.score >= 0.5;

      await db
        .update(evalCaseResults)
        .set({
          status: passed ? "passed" : "failed",
          score: judgeResult.score,
          judgeOutput: judgeResult.reasoning,
          stdoutExcerpt,
          updatedAt: new Date(),
        })
        .where(eq(evalCaseResults.id, caseResult.id));

      counts.totalScore += judgeResult.score;
      if (passed) counts.passed++;
      else counts.failed++;
    } catch (err) {
      console.error(`[eval-runner] case ${evalCase.id} error:`, err);
      await db
        .update(evalCaseResults)
        .set({
          status: "error",
          judgeOutput: err instanceof Error ? err.message : String(err),
          updatedAt: new Date(),
        })
        .where(eq(evalCaseResults.id, caseResult.id));
      counts.errors++;
    }
  }

  const total = cases.length;
  const avgScore = total > 0 ? counts.totalScore / total : 0;

  await db
    .update(evalRuns)
    .set({
      status: "done",
      finishedAt: new Date(),
      summaryJson: {
        passed: counts.passed,
        failed: counts.failed,
        errors: counts.errors,
        avgScore,
      },
    })
    .where(eq(evalRuns.id, runId));
}
