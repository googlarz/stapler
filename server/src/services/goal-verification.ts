import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { goals, issues, issueComments, agents } from "@paperclipai/db";
import type { GoalAcceptanceCriterion, IssueOriginKind } from "@paperclipai/shared";
import { MAX_GOAL_VERIFICATION_ATTEMPTS } from "@paperclipai/shared";
import {
  buildVerificationIssueDescription,
  interpretOutcome,
  parseVerificationOutcome,
  type LinkedIssueSnapshot,
  type VerificationOutcome,
} from "../lib/goal-verification-prompt.js";
import type { issueService } from "./issues.js";

/**
 * Goal verification orchestration service.
 *
 * Depends on the issueService (for creating verification issues with the
 * full wakeup/telemetry pipeline) and does the goal side of the state
 * transitions directly via the `goals` table.
 */

type IssueSvc = ReturnType<typeof issueService>;

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

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function goalVerificationService(db: Db, issueSvc: IssueSvc) {
  /**
   * Pull the goal + its linked issues (and each issue's latest comment)
   * into a snapshot suitable for the verification prompt template.
   */
  async function buildGoalSnapshot(companyId: string, goalId: string) {
    const goal = await db
      .select()
      .from(goals)
      .where(and(eq(goals.id, goalId), eq(goals.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!goal) return null;

    const linkedIssues = await db
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

    // Pull the latest comment body per issue in a single query.
    const issueIds = nonVerificationIssues.map((i) => i.id);
    const latestCommentByIssue = new Map<string, string>();
    if (issueIds.length > 0) {
      const comments = await db
        .select({
          issueId: issueComments.issueId,
          body: issueComments.body,
          createdAt: issueComments.createdAt,
        })
        .from(issueComments)
        .where(inArray(issueComments.issueId, issueIds))
        .orderBy(desc(issueComments.createdAt));
      for (const c of comments) {
        if (!latestCommentByIssue.has(c.issueId)) {
          latestCommentByIssue.set(c.issueId, c.body);
        }
      }
    }

    const snapshots: LinkedIssueSnapshot[] = nonVerificationIssues.map((i) => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      description: i.description,
      status: i.status,
      finalComment: latestCommentByIssue.get(i.id) ?? null,
    }));

    return { goal, linkedIssues: snapshots };
  }

  async function findPendingVerificationIssue(companyId: string, goalId: string) {
    return db
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
    opts?: { manualTrigger?: boolean; actorAgentId?: string | null; actorUserId?: string | null },
  ): Promise<MaybeCreateResult> {
    const snapshot = await buildGoalSnapshot(companyId, goalId);
    if (!snapshot) return { kind: "skipped", reason: "goal_not_found" };
    const { goal, linkedIssues } = snapshot;

    const criteria = (goal.acceptanceCriteria ?? []) as GoalAcceptanceCriterion[];
    if (criteria.length === 0) return { kind: "skipped", reason: "no_criteria" };

    if (goal.verificationStatus === "passed" || goal.status === "achieved") {
      return { kind: "skipped", reason: "already_achieved" };
    }

    if (!opts?.manualTrigger && goal.verificationAttempts >= MAX_GOAL_VERIFICATION_ATTEMPTS) {
      return { kind: "skipped", reason: "attempts_exhausted" };
    }

    // Already a pending verification for this goal? Don't stack them.
    const existing = await findPendingVerificationIssue(companyId, goalId);
    if (existing && existing.status !== "done" && existing.status !== "cancelled") {
      return { kind: "skipped", reason: "already_pending" };
    }

    if (linkedIssues.length === 0) return { kind: "skipped", reason: "no_linked_issues" };

    const allDone = linkedIssues.every(
      (i) => i.status === "done" || i.status === "cancelled",
    );
    if (!allDone) return { kind: "skipped", reason: "not_all_issues_done" };

    // Pick the agent. Owner agent is required — we don't silently fall back.
    if (!goal.ownerAgentId) return { kind: "skipped", reason: "no_owner_agent" };

    // Verify the owner agent is active — don't assign to a terminated agent.
    const owner = await db
      .select({ id: agents.id, status: agents.status })
      .from(agents)
      .where(and(eq(agents.id, goal.ownerAgentId), eq(agents.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!owner || owner.status === "terminated" || owner.status === "pending_approval") {
      return { kind: "skipped", reason: "no_owner_agent" };
    }

    const description = buildVerificationIssueDescription({
      goalTitle: goal.title,
      goalDescription: goal.description,
      criteria,
      linkedIssues,
    });

    // Create the verification issue via the full issue pipeline so it
    // fires telemetry, wakeup, and activity log. We pass originKind so
    // the issue PATCH hook can recognise it later.
    const verificationIssue = await issueSvc.create(companyId, {
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
    await db
      .update(goals)
      .set({
        verificationStatus: "pending",
        verificationAttempts: goal.verificationAttempts + 1,
        verificationIssueId: verificationIssue.id,
        updatedAt: new Date(),
      })
      .where(and(eq(goals.id, goalId), eq(goals.companyId, companyId)));

    return { kind: "created", verificationIssueId: verificationIssue.id };
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
  ): Promise<ApplyOutcomeResult> {
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
    if (!parsed) return { kind: "unparseable" };

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
      return { kind: "incomplete", missingCriterionIds: verdict.missingCriterionIds };
    }

    if (verdict.kind === "unclear") {
      // Treat unclear as "not achieved, don't count as a full failure".
      // Status stays pending; the UI surfaces the reasons.
      return { kind: "unclear" };
    }

    // verdict.kind === "failed" — create a follow-up issue describing the
    // failing criteria and leave the goal's attempts unchanged (next
    // cycle of issue completions may trigger another attempt).
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

    await db
      .update(goals)
      .set({
        verificationStatus: "failed",
        updatedAt: new Date(),
      })
      .where(and(eq(goals.id, goal.id), eq(goals.companyId, companyId)));

    return { kind: "failed", followUpIssueId: followUp?.id ?? null };
  }

  return {
    maybeCreateVerificationIssue,
    applyVerificationOutcome,
  };
}
