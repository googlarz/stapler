/**
 * skill-executor.ts
 *
 * Provides two integration points that heartbeat.ts calls:
 *
 * 1. `loadSkillForRun(db, companyId, runId, context)`
 *    Called before adapter.execute(). If the run has `wakeReason:
 *    "skill_command_invoked"` in its contextSnapshot, this function:
 *    - Marks the skill_invocations row as "running"
 *    - Loads the skill markdown from companySkillService
 *    - Injects `context.paperclipSkillCommand` so the adapter can use it
 *
 * 2. `finalizeSkillInvocation(db, run, outcome, issueId)`
 *    Called after adapter.execute() in both success and failure paths.
 *    Updates the skill_invocations row with the final status and (on success)
 *    the last comment posted by the agent run.
 */

import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@stapler/db";
import { issueComments, skillInvocations } from "@stapler/db";
import { companySkillService } from "./company-skills.js";
import { logger } from "../middleware/logger.js";

/** The shape injected into context.paperclipSkillCommand */
export type SkillCommandContext = {
  name: string;
  markdown: string;
  args: Record<string, unknown>;
  invocationId: string;
};

/**
 * Reads the skill command from context, loads its markdown, marks the
 * invocation row as "running", and injects `paperclipSkillCommand` into
 * the mutable context object passed to the adapter.
 *
 * No-ops if the wake reason is not "skill_command_invoked".
 */
export async function loadSkillForRun(
  db: Db,
  companyId: string,
  runId: string,
  context: Record<string, unknown>,
): Promise<void> {
  const wakeReason = typeof context.wakeReason === "string" ? context.wakeReason : null;
  if (wakeReason !== "skill_command_invoked") return;

  const skillKey = typeof context.skillCommandName === "string" ? context.skillCommandName : null;
  const invocationId = typeof context.skillInvocationId === "string" ? context.skillInvocationId : null;

  if (!skillKey || !invocationId) return;

  try {
    // Mark invocation as running.
    await db
      .update(skillInvocations)
      .set({ status: "running", heartbeatRunId: runId, updatedAt: new Date() })
      .where(eq(skillInvocations.id, invocationId));

    // Load skill markdown.
    const skillsSvc = companySkillService(db);
    const skill = await skillsSvc.getByKey(companyId, skillKey);
    if (!skill) {
      logger.warn({ invocationId, skillKey, companyId }, "skill not found for invocation — proceeding without markdown");
      return;
    }

    const args = (context.skillArgs as Record<string, unknown>) ?? {};

    context.paperclipSkillCommand = {
      name: skillKey,
      markdown: skill.markdown,
      args,
      invocationId,
    } satisfies SkillCommandContext;

    logger.info({ invocationId, skillKey, runId }, "skill command injected into run context");
  } catch (err) {
    logger.warn({ err, invocationId, skillKey, runId }, "failed to load skill for run");
  }
}

/**
 * Finalizes the skill_invocations row after the run completes.
 *
 * On success: sets status = "succeeded" and finds the last agent comment for
 * this run to use as result_comment_id.
 * On failure: sets status = "failed" and records the error message.
 *
 * No-ops if the run has no associated invocation.
 */
export async function finalizeSkillInvocation(
  db: Db,
  opts: {
    runId: string;
    outcome: "succeeded" | "failed";
    issueId: string | null | undefined;
    errorMessage?: string | null;
  },
): Promise<void> {
  const { runId, outcome, issueId, errorMessage } = opts;

  // Find the invocation for this run (also select issueId as a fallback for callers that don't have it).
  const invocation = await db
    .select({ id: skillInvocations.id, issueId: skillInvocations.issueId })
    .from(skillInvocations)
    .where(eq(skillInvocations.heartbeatRunId, runId))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!invocation) return;

  // Use caller-supplied issueId if available, fall back to the stored one.
  const resolvedIssueId = issueId ?? invocation.issueId;

  try {
    if (outcome === "succeeded") {
      // Find the last comment posted by this run in the issue thread.
      let resultCommentId: string | null = null;
      if (resolvedIssueId) {
        const lastComment = await db
          .select({ id: issueComments.id })
          .from(issueComments)
          .where(
            and(
              eq(issueComments.issueId, resolvedIssueId),
              eq(issueComments.createdByRunId, runId),
            ),
          )
          .orderBy(desc(issueComments.createdAt))
          .limit(1)
          .then((rows) => rows[0] ?? null);

        resultCommentId = lastComment?.id ?? null;
      }

      await db
        .update(skillInvocations)
        .set({
          status: "succeeded",
          resultCommentId,
          updatedAt: new Date(),
        })
        .where(eq(skillInvocations.id, invocation.id));

      logger.info({ invocationId: invocation.id, runId, resultCommentId }, "skill invocation succeeded");
    } else {
      await db
        .update(skillInvocations)
        .set({
          status: "failed",
          errorMessage: errorMessage ?? "Run failed",
          updatedAt: new Date(),
        })
        .where(eq(skillInvocations.id, invocation.id));

      logger.info({ invocationId: invocation.id, runId }, "skill invocation failed");
    }
  } catch (err) {
    logger.warn({ err, invocationId: invocation.id, runId }, "failed to finalize skill invocation");
  }
}
