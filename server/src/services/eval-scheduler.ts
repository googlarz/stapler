/**
 * Eval CI scheduler.
 *
 * Runs every minute (driven by app.ts setInterval). Checks all eval suites
 * that have a scheduleExpression and fires a run when the cron fires.
 *
 * After each scheduled run completes, compares avgScore to alertThreshold
 * and writes an activity-log alert when the score is below threshold.
 *
 * Dedup guard: `last_scheduled_run_at` is set atomically before the run
 * starts so a slow run never causes a double-fire within the same minute.
 */

import { and, isNotNull, lte, or, isNull } from "drizzle-orm";
import type { Db } from "@stapler/db";
import { evalSuites, evalRuns } from "@stapler/db";
import { eq } from "drizzle-orm";
import { parseCron, validateCron } from "./cron.js";
import { runEvalSuite } from "./eval-runner.js";
import { logActivity } from "./activity-log.js";

function cronMatchesNow(expression: string, now: Date): boolean {
  try {
    if (validateCron(expression) !== null) return false;
    const cron = parseCron(expression);
    const minute = now.getUTCMinutes();
    const hour = now.getUTCHours();
    const day = now.getUTCDate();
    const month = now.getUTCMonth() + 1;
    const weekday = now.getUTCDay();
    return (
      cron.minutes.includes(minute) &&
      cron.hours.includes(hour) &&
      cron.daysOfMonth.includes(day) &&
      cron.months.includes(month) &&
      cron.daysOfWeek.includes(weekday)
    );
  } catch {
    return false;
  }
}

/** Returns true if lastScheduledRunAt is null or more than 50 seconds ago (prevents double-fire). */
function isEligibleToFire(lastScheduledRunAt: Date | null, now: Date): boolean {
  if (!lastScheduledRunAt) return true;
  return now.getTime() - lastScheduledRunAt.getTime() > 50_000;
}

export async function tickEvalScheduler(db: Db, now: Date = new Date()): Promise<void> {
  // Load suites with a schedule expression
  const scheduledSuites = await db
    .select()
    .from(evalSuites)
    .where(isNotNull(evalSuites.scheduleExpression));

  for (const suite of scheduledSuites) {
    if (!suite.scheduleExpression) continue;
    if (!cronMatchesNow(suite.scheduleExpression, now)) continue;
    if (!isEligibleToFire(suite.lastScheduledRunAt, now)) continue;

    // Mark as fired before triggering the run (prevents double-fire if tick runs twice)
    await db
      .update(evalSuites)
      .set({ lastScheduledRunAt: now, updatedAt: now })
      .where(eq(evalSuites.id, suite.id));

    // Create eval_run record
    const [run] = await db
      .insert(evalRuns)
      .values({ suiteId: suite.id, triggeredBy: "scheduler" })
      .returning();

    if (!run) continue;

    // Run async; on completion check threshold and alert
    void runEvalSuiteWithAlert(db, run.id, suite).catch((err: unknown) => {
      console.error(`[eval-scheduler] runEvalSuite ${run.id} failed:`, err);
    });
  }
}

async function runEvalSuiteWithAlert(
  db: Db,
  runId: string,
  suite: typeof evalSuites.$inferSelect,
): Promise<void> {
  await runEvalSuite(db, runId);

  // If alertThreshold is set, check the result
  if (suite.alertThreshold == null) return;

  const runRows = await db
    .select({ summaryJson: evalRuns.summaryJson, status: evalRuns.status })
    .from(evalRuns)
    .where(eq(evalRuns.id, runId))
    .limit(1);
  const run = runRows[0];
  if (!run?.summaryJson) return;

  const { avgScore, passed, failed, errors } = run.summaryJson;
  if (avgScore < suite.alertThreshold) {
    await logActivity(db, {
      companyId: suite.companyId,
      actorType: "system",
      actorId: "eval-scheduler",
      action: "eval.alert",
      entityType: "eval_suite",
      entityId: suite.id,
      details: {
        runId,
        suiteName: suite.name,
        avgScore,
        alertThreshold: suite.alertThreshold,
        passed,
        failed,
        errors,
        message: `Eval suite "${suite.name}" scored ${Math.round(avgScore * 100)}% — below threshold ${Math.round(suite.alertThreshold * 100)}%`,
      },
    }).catch(() => {
      // Swallow — alert logging must not crash the scheduler.
    });
  }
}

/**
 * Creates a scheduler that ticks every minute.
 * Returns a stop function that clears the interval.
 */
export function createEvalScheduler(db: Db): { start: () => void; stop: () => void } {
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      if (timer) return;
      // Align to the next minute boundary for predictable cron matching
      const msToNextMinute = 60_000 - (Date.now() % 60_000);
      setTimeout(() => {
        void tickEvalScheduler(db).catch(console.error);
        timer = setInterval(() => {
          void tickEvalScheduler(db).catch(console.error);
        }, 60_000);
        timer.unref?.();
      }, msToNextMinute);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
