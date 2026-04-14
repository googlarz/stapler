import { api } from "./client";

export interface CompanyMemory {
  id: string;
  companyId: string;
  content: string;
  contentHash: string;
  contentBytes: number;
  tags: string[];
  createdByAgentId: string | null;
  createdInRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListCompanyMemoriesParams {
  tags?: string[];
  limit?: number;
  offset?: number;
}

function buildQuery(params: ListCompanyMemoriesParams): string {
  const search = new URLSearchParams();
  if (params.tags && params.tags.length > 0) search.set("tags", params.tags.join(","));
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.offset !== undefined) search.set("offset", String(params.offset));
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export const companyMemoriesApi = {
  list: (companyId: string, params: ListCompanyMemoriesParams = {}) =>
    api.get<{ items: CompanyMemory[] }>(
      `/companies/${encodeURIComponent(companyId)}/memories${buildQuery(params)}`,
    ),
  create: (companyId: string, input: { content: string; tags?: string[] }) =>
    api.post<CompanyMemory>(
      `/companies/${encodeURIComponent(companyId)}/memories`,
      input,
    ),
  remove: (companyId: string, id: string) =>
    api.delete<CompanyMemory>(
      `/companies/${encodeURIComponent(companyId)}/memories/${encodeURIComponent(id)}`,
    ),
};
