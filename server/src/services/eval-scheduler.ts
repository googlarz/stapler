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

import { and, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import type { Db } from "@stapler/db";
import { agents, companies, delegationEdges, evalSuites, evalRuns } from "@stapler/db";
import { eq } from "drizzle-orm";
import { parseCron, validateCron } from "./cron.js";
import { runEvalSuite } from "./eval-runner.js";
import { logActivity } from "./activity-log.js";
import { runPlaybookMiningForCompany } from "./playbook-miner.js";

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

/** 50-second cutoff: a suite is eligible to fire if it hasn't fired in the last 50 seconds. */
const DEDUP_CUTOFF_MS = 50_000;

export async function tickEvalScheduler(db: Db, now: Date = new Date()): Promise<void> {
  // Load suites with a schedule expression that match this minute
  const scheduledSuites = await db
    .select()
    .from(evalSuites)
    .where(isNotNull(evalSuites.scheduleExpression));

  for (const suite of scheduledSuites) {
    if (!suite.scheduleExpression) continue;
    if (!cronMatchesNow(suite.scheduleExpression, now)) continue;

    // Atomic CAS claim: only claim if last_scheduled_run_at is null or older than cutoff.
    // Under concurrent app instances only one will see affectedRows > 0.
    const cutoff = new Date(now.getTime() - DEDUP_CUTOFF_MS);
    const claimed = await db
      .update(evalSuites)
      .set({ lastScheduledRunAt: now, updatedAt: now })
      .where(
        and(
          eq(evalSuites.id, suite.id),
          or(isNull(evalSuites.lastScheduledRunAt), lt(evalSuites.lastScheduledRunAt, cutoff)),
        ),
      )
      .returning({ id: evalSuites.id });

    if (!claimed[0]) continue; // another instance already claimed this slot

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

// ── Nightly jobs ──────────────────────────────────────────────────────────────

const ORPHAN_HOURS = 4; // delegation edge is "orphan" if unresolved after 4 h

/**
 * Detect delegation edges that have been open (no resolvedAt) for more than
 * ORPHAN_HOURS hours and log an activity event for each unique issue.
 * Also runs playbook mining for every company with at least one agent that
 * has `enablePlaybooks: true`.
 */
export async function tickNightlyJobs(db: Db, now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - ORPHAN_HOURS * 60 * 60 * 1000);

  // ── Orphan delegation detection ────────────────────────────────────────────
  const orphans = await db
    .select({
      id: delegationEdges.id,
      companyId: delegationEdges.companyId,
      fromAgentId: delegationEdges.fromAgentId,
      toAgentId: delegationEdges.toAgentId,
      issueId: delegationEdges.issueId,
    })
    .from(delegationEdges)
    .where(and(isNull(delegationEdges.resolvedAt), lte(delegationEdges.createdAt, cutoff)));

  for (const edge of orphans) {
    await logActivity(db, {
      companyId: edge.companyId,
      actorType: "system",
      actorId: "eval-scheduler",
      action: "collab.orphan_delegation",
      entityType: "issue",
      entityId: edge.issueId ?? edge.fromAgentId,
      details: {
        edgeId: edge.id,
        fromAgentId: edge.fromAgentId,
        toAgentId: edge.toAgentId,
        openSinceHours: ORPHAN_HOURS,
      },
    }).catch(() => {});
  }

  // ── Playbook mining ────────────────────────────────────────────────────────
  const allCompanies = await db.select({ id: companies.id }).from(companies);
  for (const company of allCompanies) {
    await runPlaybookMiningForCompany(db, company.id).catch(() => {});
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
        const tick = () => {
          const now = new Date();
          void tickEvalScheduler(db, now).catch(console.error);
          // Nightly jobs fire at 02:00 UTC
          if (now.getUTCHours() === 2 && now.getUTCMinutes() === 0) {
            void tickNightlyJobs(db, now).catch(console.error);
          }
        };
        tick();
        timer = setInterval(tick, 60_000);
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
