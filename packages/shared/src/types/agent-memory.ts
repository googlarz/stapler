export interface AgentMemory {
  id: string;
  companyId: string;
  agentId: string;
  content: string;
  contentHash: string;
  contentBytes: number;
  tags: string[];
  scope: AgentMemoryScope;
  wikiSlug?: string | null;
  createdInRunId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** When set and past, the memory is excluded from lists, searches, and run-start injection. */
  expiresAt?: Date | null;
}

export type AgentMemoryScope = "agent";

/** Row returned by trigram search — carries an extra similarity score. */
export interface AgentMemorySearchResult extends AgentMemory {
  /** pg_trgm similarity score between query and `content`, 0..1. */
  score: number;
}

export interface AgentMemorySaveResult {
  memory: AgentMemory;
  /** True if an identical memory already existed for this agent. */
  deduped: boolean;
}

/**
 * A memory entry injected into an agent's execution context at run-start.
 * Lighter than the full AgentMemory — only the fields an adapter needs to
 * build the memories section of the system/user prompt.
 *
 * `source` distinguishes the agent's own memories from company-wide shared
 * knowledge so adapters can render them in separate prompt sections.
 */
export interface InjectedMemory {
  id: string;
  content: string;
  tags: string[];
  score: number;
  wikiSlug?: string | null;
  /** "agent" = this agent's own memory; "company" = shared company knowledge. */
  source: "agent" | "company";
}

/** A named wiki page belonging to an agent (Karpathy-style compiled knowledge). */
export interface AgentWikiPage {
  id: string;
  agentId: string;
  wikiSlug: string;
  content: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}
