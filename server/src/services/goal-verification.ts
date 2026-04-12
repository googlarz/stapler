import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { goals, issues, issueComments, agents } from "@paperclipai/db";
import type { GoalAcceptanceCriterion, IssueOriginKind } from "@paperclipai/shared";
import { MAX_GOAL_VERIFICATION_ATTEMPTS } from "@paperclipai/shared";
import {
  buildVerificationIssueDescription,
  interpretOutcome,
  parseVerificationOutcome,
  MAX_COMMENTS_PER_ISSUE,
  type LinkedIssueSnapshot,
  type VerificationOutcome,
} from "../lib/goal-verification-prompt.js";
import { logActivity } from "./activity-log.js";
import { issueService } from "./issues.js";
import { queueIssueAssignmentWakeup, type IssueAssignmentWakeupDeps } from "./issue-assignment-wakeup.js";

/**
 * Actor context used by the verification service to write activity-log
 * entries for state transitions it performs. The service itself has no
 * request, so callers pass the resolved actor (from `getActorInfo(req)`
 * on the route side, or a `system` stand-in when the mutation is a
 * background consequence of an observed agent outcome).
 */
export interface VerificationActor {
  actorType: "agent" | "user" | "system";
  actorId: string;
  agentId?: string | null;
  runId?: string | null;
}

const SYSTEM_ACTOR: VerificationActor = {
  actorType: "system",
  actorId: "goal-verification",
  agentId: null,
  runId: null,
};

/**
 * Goal verification orchestration service.
 *
 * Depends on the issueService (for creating verification issues with the
 * full wakeup/telemetry pipeline) and does the goal side of the state
 * transitions directly via the `goals` table.
 */

type IssueSvc = ReturnType<typeof issueService>;
type GoalVerificationDb = Pick<Db, "select" | "update" | "execute">;

// ---------------------------------------------------------------------------
// Outcome types returned to the caller so they can log / respond
// ---------------------------------------------------------------------------

export type MaybeCreateResult =
  | { kind: "created"; verificationIssueId: string }
  | { kind: "skipped"; reason: SkippedReason };

export type SkippedReason =
  | "goal_not_found"
  | "no_criteria"
  | "already_achieved"
  | "already_pending"
  | "attempts_exhausted"
  | "no_linked_issues"
  | "not_all_issues_done"
  | "no_owner_agent";

export type ApplyOutcomeResult =
  | { kind: "passed" }
  | { kind: "failed"; followUpIssueId: string | null }
  | { kind: "unclear" }
  | { kind: "unparseable" }
  | { kind: "incomplete"; missingCriterionIds: string[] };

export function hasCompletedLinkedWorkForVerification(
  linkedIssues: Array<Pick<LinkedIssueSnapshot, "status">>,
) {
  const nonCancelledIssues = linkedIssues.filter((issue) => issue.status !== "cancelled");
  return nonCancelledIssues.length > 0 && nonCancelledIssues.every((issue) => issue.status === "done");
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function goalVerificationService(db: Db, issueSvc: IssueSvc, heartbeat?: IssueAssignmentWakeupDeps) {
  /**
   * Pull the goal + its linked issues (and each issue's latest comment)
   * into a snapshot suitable for the verification prompt template.
   */
  async function buildGoalSnapshot(companyId: string, goalId: string, dbOrTx: GoalVerificationDb = db) {
    const goal = await dbOrTx
      .select()
      .from(goals)
      .where(and(eq(goals.id, goalId), eq(goals.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!goal) return null;

    const linkedIssues = await dbOrTx
      .select({
        id: issues.id,
        identifier: issues.identifier,
        title: issues.title,
        description: issues.description,
        status: issues.status,
        originKind: issues.originKind,
      })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          eq(issues.goalId, goalId),
          // Exclude prior verification issues — we don't want the agent
          // to judge its own past verdicts.
          // Cast `originKind` column to a string; the typed enum is
          // enforced at the route layer.
          // drizzle's `!=` is `ne`, but we want `<>`; inArray excluded
          // works fine for a small set of exclusions.
        ),
      );

    const nonVerificationIssues = linkedIssues.filter(
      (i) => i.originKind !== "goal_verification",
    );

    // Pull the last MAX_COMMENTS_PER_ISSUE comments per issue in a single
    // query. We fetch newest-first (desc) then reverse per-issue so the
    // verifying agent reads the work narrative chronologically.
    const issueIds = nonVerificationIssues.map((i) => i.id);
    const commentsByIssue = new Map<string, string[]>();
    if (issueIds.length > 0) {
      const comments = await dbOrTx
        .select({
          issueId: issueComments.issueId,
          body: issueComments.body,
          createdAt: issueComments.createdAt,
        })
        .from(issueComments)
        .where(inArray(issueComments.issueId, issueIds))
        .orderBy(desc(issueComments.createdAt));
      for (const c of comments) {
        const existing = commentsByIssue.get(c.issueId) ?? [];
        if (existing.length < MAX_COMMENTS_PER_ISSUE) {
          existing.push(c.body);
          commentsByIssue.set(c.issueId, existing);
        }
      }
    }

    const snapshots: LinkedIssueSnapshot[] = nonVerificationIssues.map((i) => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      description: i.description,
      status: i.status,
      // Reverse from newest-first (DB order) to oldest-first (narrative order)
      recentComments: [...(commentsByIssue.get(i.id) ?? [])].reverse(),
    }));

    return { goal, linkedIssues: snapshots };
  }

  async function findPendingVerificationIssue(
    companyId: string,
    goalId: string,
    dbOrTx: GoalVerificationDb = db,
  ) {
    return dbOrTx
      .select({ id: issues.id, status: issues.status })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          eq(issues.goalId, goalId),
          eq(issues.originKind, "goal_verification" as IssueOriginKind),
        ),
      )
      .orderBy(desc(issues.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  /**
   * Called after an issue transitions to `done` (or manually via the UI
   * retrigger button). Guards all the preconditions and, if they pass,
   * creates a verification issue assigned to the goal's owner agent and
   * updates the goal's verification state to `pending`.
   */
  async function maybeCreateVerificationIssue(
    companyId: string,
    goalId: string,
    opts?: {
      manualTrigger?: boolean;
      actorAgentId?: string | null;
      actorUserId?: string | null;
      /**
       * Audit actor. If omitted, defaults to a `system` stand-in —
       * appropriate for the auto-fire hook path where no user action
       * directly triggered the mutation.
       */
      actor?: VerificationActor;
    },
  ): Promise<MaybeCreateResult> {
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select ${goals.id} from ${goals}
            where ${and(eq(goals.id, goalId), eq(goals.companyId, companyId))}
            for update`,
      );

      const snapshot = await buildGoalSnapshot(companyId, goalId, tx);
      if (!snapshot) return { kind: "skipped" as const, reason: "goal_not_found" as const };
      const { goal, linkedIssues } = snapshot;

      const criteria = (goal.acceptanceCriteria ?? []) as GoalAcceptanceCriterion[];
      if (criteria.length === 0) return { kind: "skipped" as const, reason: "no_criteria" as const };

      if (goal.verificationStatus === "passed" || goal.status === "achieved") {
        return { kind: "skipped" as const, reason: "already_achieved" as const };
      }

      if (!opts?.manualTrigger && goal.verificationAttempts >= MAX_GOAL_VERIFICATION_ATTEMPTS) {
        return { kind: "skipped" as const, reason: "attempts_exhausted" as const };
      }

      // Already a pending verification for this goal? Don't stack them.
      const existing = await findPendingVerificationIssue(companyId, goalId, tx);
      if (existing && existing.status !== "done" && existing.status !== "cancelled") {
        return { kind: "skipped" as const, reason: "already_pending" as const };
      }

      if (linkedIssues.length === 0) return { kind: "skipped" as const, reason: "no_linked_issues" as const };

      if (!hasCompletedLinkedWorkForVerification(linkedIssues)) {
        return { kind: "skipped" as const, reason: "not_all_issues_done" as const };
      }

      // Pick the agent. Owner agent is required — we don't silently fall back.
      if (!goal.ownerAgentId) return { kind: "skipped" as const, reason: "no_owner_agent" as const };

      // Verify the owner agent is active — don't assign to a terminated agent.
      const owner = await tx
        .select({ id: agents.id, status: agents.status })
        .from(agents)
        .where(and(eq(agents.id, goal.ownerAgentId), eq(agents.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!owner || owner.status === "terminated" || owner.status === "pending_approval") {
        return { kind: "skipped" as const, reason: "no_owner_agent" as const };
      }

      const description = buildVerificationIssueDescription({
        goalTitle: goal.title,
        goalDescription: goal.description,
        criteria,
        linkedIssues,
        // nextAttempt is goal.verificationAttempts + 1 (computed just below)
        attemptNumber: goal.verificationAttempts + 1,
      });

      // Create the verification issue via the full issue pipeline within
      // the same transaction protected by the goal row lock. This prevents
      // concurrent final-issue completions from both passing the pending
      // check and creating duplicate verification issues.
      const verificationIssue = await issueService(tx as unknown as Db).create(companyId, {
        title: `Verify: ${goal.title}`,
        description,
        status: "todo",
        priority: "medium",
        assigneeAgentId: goal.ownerAgentId,
        goalId,
        originKind: "goal_verification",
      });

      // Update the goal in a single statement: bump attempts, set pending,
      // point to the new issue. We do this AFTER issueService.create() so
      // if creation fails the goal is unchanged.
      const nextAttempt = goal.verificationAttempts + 1;
      await tx
        .update(goals)
        .set({
          verificationStatus: "pending",
          verificationAttempts: nextAttempt,
          verificationIssueId: verificationIssue.id,
          updatedAt: new Date(),
        })
        .where(and(eq(goals.id, goalId), eq(goals.companyId, companyId)));

      return {
        kind: "created" as const,
        verificationIssueId: verificationIssue.id,
        attemptNumber: nextAttempt,
        criteriaCount: criteria.length,
        ownerAgentId: goal.ownerAgentId,
      };
    });

    if (result.kind === "skipped") return result;

    // Audit: record the verification request against the GOAL (not the
    // issue — the issue's creation is logged separately by
    // issueService.create). This captures the goal-side state
    // transition (attempts++, status=pending) for the audit trail.
    const actor = opts?.actor ?? SYSTEM_ACTOR;
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? null,
      runId: actor.runId ?? null,
      action: "goal.verification_requested",
      entityType: "goal",
      entityId: goalId,
      details: {
        verificationIssueId: result.verificationIssueId,
        attemptNumber: result.attemptNumber,
        manualTrigger: opts?.manualTrigger === true,
        criteriaCount: result.criteriaCount,
        ownerAgentId: result.ownerAgentId,
      },
    });

    // Wake the assigned owner agent so they pick up the verification issue
    // immediately instead of waiting for their heartbeat timer.
    // queueIssueAssignmentWakeup returns void | Promise and has its own
    // internal .catch() that logs errors — no outer handler needed.
    if (heartbeat && result.ownerAgentId) {
      void queueIssueAssignmentWakeup({
        heartbeat,
        issue: {
          id: result.verificationIssueId,
          assigneeAgentId: result.ownerAgentId,
          status: "todo",
        },
        reason: "Goal verification issue created — please verify the goal outcome",
        mutation: "goal_verification_created",
        contextSource: "goal_verification",
        requestedByActorType: "system",
        requestedByActorId: null,
      });
    }

    return { kind: "created", verificationIssueId: result.verificationIssueId };
  }

  /**
   * Called when a verification issue (one with `originKind =
   * goal_verification`) transitions to `done`. Parses the agent's latest
   * comment, interprets the outcome against the goal's criteria, and
   * updates goal state accordingly.
   */
  async function applyVerificationOutcome(
    companyId: string,
    verificationIssueId: string,
    agentCommentBody: string,
    opts?: { actor?: VerificationActor },
  ): Promise<ApplyOutcomeResult> {
    const actor = opts?.actor ?? SYSTEM_ACTOR;
    // Resolve the goal this verification was for.
    const issueRow = await db
      .select({
        id: issues.id,
        goalId: issues.goalId,
        title: issues.title,
        companyId: issues.companyId,
      })
      .from(issues)
      .where(and(eq(issues.id, verificationIssueId), eq(issues.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!issueRow || !issueRow.goalId) return { kind: "unparseable" };

    const goal = await db
      .select()
      .from(goals)
      .where(and(eq(goals.id, issueRow.goalId), eq(goals.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!goal) return { kind: "unparseable" };

    const parsed: VerificationOutcome | null = parseVerificationOutcome(agentCommentBody);
    if (!parsed) {
      await db
        .update(goals)
        .set({
          verificationStatus: "not_started",
          verificationIssueId: null,
          updatedAt: new Date(),
        })
        .where(and(eq(goals.id, goal.id), eq(goals.companyId, companyId)));

      return { kind: "unparseable" };
    }

    const criteria = (goal.acceptanceCriteria ?? []) as GoalAcceptanceCriterion[];
    const verdict = interpretOutcome(criteria, parsed);

    if (verdict.kind === "passed") {
      await db
        .update(goals)
        .set({
          status: "achieved",
          verificationStatus: "passed",
          verifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(goals.id, goal.id), eq(goals.companyId, companyId)));

      // Audit: the ACHIEVED transition is the critical auditable event
      // here. It moves a goal from pending/active to achieved without
      // direct human approval (per the tree's governance semantics) —
      // the audit row captures which verification issue drove it and
      // who was acting.
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? null,
        runId: actor.runId ?? null,
        action: "goal.achieved",
        entityType: "goal",
        entityId: goal.id,
        details: {
          verificationIssueId,
          criteriaCount: criteria.length,
          previousStatus: goal.status,
          via: "verification_outcome",
        },
      });
      return { kind: "passed" };
    }

    if (verdict.kind === "incomplete") {
      await db
        .update(goals)
        .set({
          verificationStatus: "failed",
          updatedAt: new Date(),
        })
        .where(and(eq(goals.id, goal.id), eq(goals.companyId, companyId)));

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? null,
        runId: actor.runId ?? null,
        action: "goal.verification_incomplete",
        entityType: "goal",
        entityId: goal.id,
        details: {
          verificationIssueId,
          missingCriterionIds: verdict.missingCriterionIds,
          attemptNumber: goal.verificationAttempts,
        },
      });
      return { kind: "incomplete", missingCriterionIds: verdict.missingCriterionIds };
    }

    if (verdict.kind === "unclear") {
      // Treat unclear as "not achieved, don't count as a full failure".
      // Clear the pending state so a human or later trigger can retry
      // instead of leaving the goal blocked on a completed verification
      // issue forever.
      await db
        .update(goals)
        .set({
          verificationStatus: "not_started",
          verificationIssueId: null,
          updatedAt: new Date(),
        })
        .where(and(eq(goals.id, goal.id), eq(goals.companyId, companyId)));

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? null,
        runId: actor.runId ?? null,
        action: "goal.verification_unclear",
        entityType: "goal",
        entityId: goal.id,
        details: {
          verificationIssueId,
          attemptNumber: goal.verificationAttempts,
          nextVerificationStatus: "not_started",
        },
      });
      return { kind: "unclear" };
    }

    // verdict.kind === "failed" — flip the goal to "failed" first so that
    // a crash between this update and the follow-up issue create leaves the
    // goal in a valid terminal state rather than stuck in "pending" forever
    // (which would cause the next verification cycle to see "already_pending"
    // and silently skip). The follow-up issue is created after the goal update
    // so the audit trail is correct on crash recovery.
    await db
      .update(goals)
      .set({
        verificationStatus: "failed",
        updatedAt: new Date(),
      })
      .where(and(eq(goals.id, goal.id), eq(goals.companyId, companyId)));

    const failingText = verdict.failingCriteria
      .map((v) => {
        const c = criteria.find((cc) => cc.id === v.criterionId);
        return `- **${c?.text ?? v.criterionId}**: ${v.reason}`;
      })
      .join("\n");

    let followUp: { id: string } | null = null;
    if (goal.ownerAgentId) {
      followUp = await issueSvc.create(companyId, {
        title: `Fix: ${goal.title} verification failures`,
        description: [
          "One or more acceptance criteria failed verification for this goal.",
          "",
          "**Failing criteria:**",
          failingText,
          "",
          "Resolve each, then the verification loop will retry automatically on the next issue-done event.",
        ].join("\n"),
        status: "todo",
        priority: "high",
        assigneeAgentId: goal.ownerAgentId,
        goalId: goal.id,
        originKind: "manual",
      });
    }

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? null,
      runId: actor.runId ?? null,
      action: "goal.verification_failed",
      entityType: "goal",
      entityId: goal.id,
      details: {
        verificationIssueId,
        attemptNumber: goal.verificationAttempts,
        failingCriterionIds: verdict.failingCriteria.map((c) => c.criterionId),
        followUpIssueId: followUp?.id ?? null,
      },
    });

    return { kind: "failed", followUpIssueId: followUp?.id ?? null };
  }

  return {
    maybeCreateVerificationIssue,
    applyVerificationOutcome,
  };
}
