/**
 * skill-invoker.ts
 *
 * Parses slash commands from issue-comment bodies, looks up the referenced
 * skill in the company's skill registry, creates a `skill_invocations` row,
 * and enqueues the agent wakeup with `wakeReason: "skill_command_invoked"`.
 */

import { eq } from "drizzle-orm";
import type { Db } from "@stapler/db";
import { skillInvocations } from "@stapler/db";
import { logger } from "../middleware/logger.js";

/** Parsed result from a comment body that starts with a slash command. */
export type ParsedSkillCommand = {
  /** e.g. "plan-phase" or "gsd:debug" */
  skillKey: string;
  /** Raw trailing text after the skill name, split on whitespace. */
  rawArgs: string[];
  /** Structured args parsed from rawArgs (key=value pairs + positionals). */
  args: Record<string, unknown>;
};

/**
 * Detects a slash command in the comment body.
 *
 * Matches the first line if it starts with `/` followed by a non-space
 * identifier (letters, digits, hyphens, colons for namespacing like `gsd:plan-phase`).
 *
 * Returns null when the body is not a slash command.
 */
export function parseSlashCommand(body: string): ParsedSkillCommand | null {
  const firstLine = body.split("\n")[0]?.trim() ?? "";
  const match = firstLine.match(/^\/([a-zA-Z0-9][a-zA-Z0-9:_-]*)((?:\s+\S+)*)\s*$/);
  if (!match) return null;

  const skillKey = match[1]!;
  const rawArgs = (match[2] ?? "").trim().split(/\s+/).filter(Boolean);

  // Parse key=value pairs; everything else is positional under "_".
  const args: Record<string, unknown> = {};
  const positional: string[] = [];
  for (const arg of rawArgs) {
    const kv = arg.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/);
    if (kv) {
      args[kv[1]!] = kv[2];
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 0) args["_"] = positional;

  return { skillKey, rawArgs, args };
}

export type InvokeSkillOptions = {
  db: Db;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  heartbeatWakeup: (agentId: string, opts?: any) => Promise<unknown>;
  companyId: string;
  issueId: string;
  agentId: string;
  skillKey: string;
  args: Record<string, unknown>;
  triggerCommentId: string | null;
  requestedByActorType: string;
  requestedByActorId: string;
};

/**
 * Creates a `skill_invocations` row and wakes the agent with
 * `wakeReason: "skill_command_invoked"`.
 *
 * Returns the invocation id.
 */
export async function invokeSkill(opts: InvokeSkillOptions): Promise<string> {
  const {
    db,
    heartbeatWakeup,
    companyId,
    issueId,
    agentId,
    skillKey,
    args,
    triggerCommentId,
    requestedByActorType,
    requestedByActorId,
  } = opts;

  // Insert invocation row (status: "pending").
  const [invocation] = await db
    .insert(skillInvocations)
    .values({
      companyId,
      issueId,
      agentId,
      skillKey,
      args: Object.keys(args).length > 0 ? args : null,
      status: "pending",
      triggerCommentId,
    })
    .returning({ id: skillInvocations.id });

  if (!invocation) {
    throw new Error("Failed to insert skill_invocations row");
  }

  const invocationId = invocation.id;

  // Wake the agent.  If the wakeup fails, mark the invocation as failed
  // so it does not stay stuck in "pending" forever.
  try {
    await heartbeatWakeup(agentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "skill_command_invoked",
      payload: {
        issueId,
        skillKey,
        skillInvocationId: invocationId,
      },
      requestedByActorType,
      requestedByActorId,
      contextSnapshot: {
        issueId,
        taskId: issueId,
        wakeReason: "skill_command_invoked",
        skillCommandName: skillKey,
        skillInvocationId: invocationId,
        skillArgs: args,
        source: "skill.slash_command",
      },
    });
  } catch (err) {
    logger.warn({ err, invocationId, agentId, skillKey }, "failed to wake agent for skill invocation — marking invocation failed");
    await db
      .update(skillInvocations)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(skillInvocations.id, invocationId));
    throw err;
  }

  logger.info({ invocationId, agentId, skillKey, issueId }, "skill invocation created");
  return invocationId;
}

/**
 * Marks a `skill_invocations` row as cancelled.
 */
export async function cancelSkillInvocation(db: Db, invocationId: string): Promise<void> {
  await db
    .update(skillInvocations)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(skillInvocations.id, invocationId));
}
