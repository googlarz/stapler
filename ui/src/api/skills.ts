import { api } from "./client";

export interface InstanceSkill {
  id: string;
  key: string;
  slug: string;
  name: string;
  description: string | null;
  sourceType: string;
  sourceLocator: string | null;
  sourceRef: string | null;
  trustLevel: string;
  compatibility: string;
  fileInventory: Array<Record<string, unknown>>;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export const instanceSkillsApi = {
  list: () => api.get<InstanceSkill[]>("/instance/skills"),
  get: (id: string) => api.get<InstanceSkill>(`/instance/skills/${encodeURIComponent(id)}`),
  import: (source: string) =>
    api.post<{ imported: Array<{ skill: InstanceSkill; action: string }>; warnings: string[] }>(
      "/instance/skills/import",
      { source },
    ),
  update: (id: string, patch: Partial<Pick<InstanceSkill, "name" | "description">>) =>
    api.patch<InstanceSkill>(`/instance/skills/${encodeURIComponent(id)}`, patch),
  delete: (id: string) =>
    api.delete<{ ok: boolean; id: string; key: string }>(`/instance/skills/${encodeURIComponent(id)}`),
};

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
