import type {
  AgentMemory,
  AgentMemorySaveResult,
  AgentMemorySearchResult,
} from "@stapler/shared";
import { api } from "./client";

export interface AgentMemoryListResponse {
  items: AgentMemory[];
  mode: "list";
}

export interface AgentMemorySearchResponse {
  items: AgentMemorySearchResult[];
  mode: "search";
}

export type AgentMemoryQueryResponse =
  | AgentMemoryListResponse
  | AgentMemorySearchResponse;

export interface ListAgentMemoriesParams {
  q?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

function buildQuery(params: ListAgentMemoriesParams): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.tags && params.tags.length > 0) search.set("tags", params.tags.join(","));
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.offset !== undefined) search.set("offset", String(params.offset));
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export interface AgentMemoryStats {
  episodic: { count: number; bytes: number };
  wiki: { count: number; bytes: number };
  total: { count: number; bytes: number };
  limits: { maxPerAgent: number; maxContentBytes: number; searchThreshold: number };
}

export const agentMemoriesApi = {
  list: (agentId: string, params: ListAgentMemoriesParams = {}) =>
    api.get<AgentMemoryQueryResponse>(
      `/agents/${encodeURIComponent(agentId)}/memories${buildQuery(params)}`,
    ),
  get: (agentId: string, id: string) =>
    api.get<AgentMemory>(
      `/agents/${encodeURIComponent(agentId)}/memories/${encodeURIComponent(id)}`,
    ),
  create: (agentId: string, input: { content: string; tags?: string[] }) =>
    api.post<AgentMemorySaveResult>(
      `/agents/${encodeURIComponent(agentId)}/memories`,
      input,
    ),
  remove: (agentId: string, id: string) =>
    api.delete<AgentMemory>(
      `/agents/${encodeURIComponent(agentId)}/memories/${encodeURIComponent(id)}`,
    ),
  wikiUpsert: (agentId: string, slug: string, input: { content: string; tags?: string[] }) =>
    api.put<AgentMemory>(
      `/agents/${encodeURIComponent(agentId)}/memories/wiki/${encodeURIComponent(slug)}`,
      input,
    ),
  wikiRemoveBySlug: (agentId: string, slug: string) =>
    api.delete<AgentMemory>(
      `/agents/${encodeURIComponent(agentId)}/memories/wiki/${encodeURIComponent(slug)}`,
    ),
  stats: (agentId: string) =>
    api.get<AgentMemoryStats>(
      `/agents/${encodeURIComponent(agentId)}/memories/stats`,
    ),
};
