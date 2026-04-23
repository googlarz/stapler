import { api } from "./client";

export interface Output {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  status: "pending_approval" | "active" | "archived";
  draftContent: string;
  proposedByAgentId: string | null;
  approvedByAgentId: string | null;
  approvalIssueId: string | null;
  latestVersionNumber: number;
  latestVersionReleasedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutputVersion {
  id: string;
  outputId: string;
  versionNumber: number;
  content: string;
  releasedByAgentId: string | null;
  releaseNotes: string | null;
  createdAt: string;
}

export interface OutputWithVersions extends Output {
  versions: OutputVersion[];
}

export const outputsApi = {
  list: (companyId: string) => api.get<Output[]>(`/companies/${companyId}/outputs`),
  get: (id: string) => api.get<OutputWithVersions>(`/outputs/${id}`),
  propose: (companyId: string, data: { title: string; description?: string }) =>
    api.post<Output>(`/companies/${companyId}/outputs`, data),
  update: (id: string, data: { title?: string; description?: string; status?: string }) =>
    api.patch<Output>(`/outputs/${id}`, data),
  updateDraft: (id: string, content: string) =>
    api.patch<Output>(`/outputs/${id}/draft`, { content }),
  approve: (id: string) => api.post<Output>(`/outputs/${id}/approve`, {}),
  releaseVersion: (id: string, releaseNotes?: string) =>
    api.post<OutputVersion>(`/outputs/${id}/versions`, { releaseNotes }),
  remove: (id: string) => api.delete<Output>(`/outputs/${id}`),
};
