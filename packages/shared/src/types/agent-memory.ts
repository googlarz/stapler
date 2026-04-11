export interface AgentMemory {
  id: string;
  companyId: string;
  agentId: string;
  content: string;
  contentHash: string;
  contentBytes: number;
  tags: string[];
  scope: AgentMemoryScope;
  createdInRunId: string | null;
  createdAt: Date;
  updatedAt: Date;
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
