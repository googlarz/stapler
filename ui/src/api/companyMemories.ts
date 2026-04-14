import { api } from "./client";

export interface CompanyMemory {
  id: string;
  companyId: string;
  content: string;
  contentHash: string;
  contentBytes: number;
  tags: string[];
  wikiSlug: string | null;
  createdByAgentId: string | null;
  createdInRunId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string | null;
}

export interface CompanyMemorySearchResult extends CompanyMemory {
  score: number;
}

export interface CompanyMemoryStats {
  episodic: { count: number; bytes: number };
  wiki: { count: number; bytes: number };
  total: { count: number; bytes: number };
}

export interface ListCompanyMemoriesParams {
  q?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

function buildQuery(params: ListCompanyMemoriesParams): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.tags && params.tags.length > 0) search.set("tags", params.tags.join(","));
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.offset !== undefined) search.set("offset", String(params.offset));
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export interface CompanyMemoryListResponse {
  items: CompanyMemory[];
  mode: "list";
}

export interface CompanyMemorySearchResponse {
  items: CompanyMemorySearchResult[];
  mode: "search";
}

export type CompanyMemoryQueryResponse = CompanyMemoryListResponse | CompanyMemorySearchResponse;

export const companyMemoriesApi = {
  list: (companyId: string, params: ListCompanyMemoriesParams = {}) =>
    api.get<CompanyMemoryQueryResponse>(
      `/companies/${encodeURIComponent(companyId)}/memories${buildQuery(params)}`,
    ),
  create: (companyId: string, input: { content: string; tags?: string[]; expiresAt?: string }) =>
    api.post<CompanyMemory>(
      `/companies/${encodeURIComponent(companyId)}/memories`,
      input,
    ),
  patch: (
    companyId: string,
    id: string,
    update: { tags?: string[]; expiresAt?: string | null },
  ) =>
    api.patch<CompanyMemory>(
      `/companies/${encodeURIComponent(companyId)}/memories/${encodeURIComponent(id)}`,
      update,
    ),
  remove: (companyId: string, id: string) =>
    api.delete<CompanyMemory>(
      `/companies/${encodeURIComponent(companyId)}/memories/${encodeURIComponent(id)}`,
    ),
  wikiUpsert: (companyId: string, slug: string, input: { content: string; tags?: string[] }) =>
    api.put<CompanyMemory>(
      `/companies/${encodeURIComponent(companyId)}/memories/wiki/${encodeURIComponent(slug)}`,
      input,
    ),
  wikiList: (companyId: string) =>
    api.get<{ items: CompanyMemory[] }>(
      `/companies/${encodeURIComponent(companyId)}/memories/wiki`,
    ),
  wikiRemoveBySlug: (companyId: string, slug: string) =>
    api.delete<CompanyMemory>(
      `/companies/${encodeURIComponent(companyId)}/memories/wiki/${encodeURIComponent(slug)}`,
    ),
  stats: (companyId: string) =>
    api.get<CompanyMemoryStats>(
      `/companies/${encodeURIComponent(companyId)}/memories/stats`,
    ),
};
