import { api } from "./client";

export interface SkillInvocation {
  id: string;
  companyId: string;
  issueId: string;
  agentId: string | null;
  skillKey: string;
  args: Record<string, unknown> | null;
  /** pending | running | succeeded | failed | cancelled */
  status: string;
  triggerCommentId: string | null;
  heartbeatRunId: string | null;
  resultCommentId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export const skillInvocationsApi = {
  get: (invocationId: string) =>
    api.get<SkillInvocation>(`/skill-invocations/${encodeURIComponent(invocationId)}`),

  listForIssue: (issueId: string) =>
    api.get<SkillInvocation[]>(`/issues/${encodeURIComponent(issueId)}/skill-invocations`),
};
