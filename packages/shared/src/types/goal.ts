import type { GoalLevel, GoalStatus, GoalVerificationStatus } from "../constants.js";

/**
 * Structured acceptance criterion attached to a goal. Turns a goal from
 * a free-text statement into an outcome with a testable checklist.
 * Verification (pass/fail tracking against linked issues) is a follow-up.
 */
export interface GoalAcceptanceCriterion {
  id: string;
  text: string;
  required: boolean;
  order: number;
}

/**
 * Progress summary computed from issues linked to the goal via `issues.goalId`.
 * Returned only on detail endpoints (not in list responses) to avoid N+1.
 */
export interface GoalProgress {
  totalIssues: number;
  doneIssues: number;
  completionPct: number;
}

export interface Goal {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  level: GoalLevel;
  status: GoalStatus;
  parentId: string | null;
  ownerAgentId: string | null;
  acceptanceCriteria: GoalAcceptanceCriterion[];
  targetDate: string | null;
  verificationStatus: GoalVerificationStatus;
  verificationAttempts: number;
  verifiedAt: Date | null;
  verificationIssueId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GoalWithProgress extends Goal {
  progress: GoalProgress;
}
