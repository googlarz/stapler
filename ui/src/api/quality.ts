import { api } from "./client";

export interface RunScoreRow {
  id: string;
  runId: string;
  score: number;
  reasoning: string | null;
  judgedAt: string;
  rubricSource: string;
  judgeModel: string | null;
}

export interface AgentQualityTrend {
  windowDays: number;
  avgScore: number | null;
  sampleSize: number;
  recent: RunScoreRow[];
}

export interface AgentQualityTrends {
  agentId: string;
  companyId: string;
  windows: {
    d7: { windowDays: number; avgScore: number | null; sampleSize: number };
    d30: { windowDays: number; avgScore: number | null; sampleSize: number };
    d90: { windowDays: number; avgScore: number | null; sampleSize: number };
  };
}

export interface CompanyQualityAgentSummary {
  agentId: string;
  avgScore: number | null;
  sampleSize: number;
  lastJudgedAt: string | null;
}

export interface CompanyQualityTrend {
  windowDays: number;
  items: CompanyQualityAgentSummary[];
}

export interface CompanyRecentScore extends RunScoreRow {
  agentId: string;
  runStatus: string;
  runStartedAt: string | null;
}

export interface CollabPairStats {
  fromAgentId: string;
  toAgentId: string;
  toAgentName: string;
  totalDelegations: number;
  successCount: number;
  winRate: number;
  avgRoundTripMs: number | null;
}

export interface PlaybookRow {
  id: string;
  agentId: string;
  title: string;
  taskPatternNorm: string;
  steps: string; // JSON string array
  version: number;
  winRate: number | null;
  sampleSize: number;
  abTesting: number;
  active: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaybookExperiment {
  id: string;
  controlPlaybookId: string;
  challengerPlaybookId: string;
  status: string;
  controlWins: number;
  challengerWins: number;
  totalRuns: number;
  minRuns: number;
  controlWinRate: number | null;
  challengerWinRate: number | null;
  createdAt: string;
  concludedAt: string | null;
}

export const qualityApi = {
  runScore: (runId: string) => api.get<RunScoreRow>(`/runs/${runId}/score`),
  agentTrend: (agentId: string, limit = 20) =>
    api.get<AgentQualityTrend>(`/agents/${agentId}/quality/trend?limit=${limit}`),
  agentTrends: (agentId: string) =>
    api.get<AgentQualityTrends>(`/agents/${agentId}/quality/trends`),
  companyTrend: (companyId: string) =>
    api.get<CompanyQualityTrend>(`/companies/${companyId}/quality/trend`),
  companyRecent: (companyId: string, limit = 50) =>
    api.get<{ items: CompanyRecentScore[] }>(`/companies/${companyId}/quality/recent?limit=${limit}`),
  agentCollabStats: (agentId: string) =>
    api.get<{ items: CollabPairStats[] }>(`/agents/${agentId}/collab-stats`),
  agentPlaybooks: (agentId: string) =>
    api.get<{ items: PlaybookRow[] }>(`/agents/${agentId}/playbooks`),
  minePlaybooks: (agentId: string) =>
    api.post<{ playbooksUpserted: number }>(`/agents/${agentId}/playbooks/mine`, {}),
  updatePlaybook: (agentId: string, playbookId: string, data: { active: boolean }) =>
    api.patch<PlaybookRow>(`/agents/${agentId}/playbooks/${playbookId}`, data),
  companyExperiments: (companyId: string) =>
    api.get<{ items: PlaybookExperiment[] }>(`/companies/${companyId}/playbook-experiments`),
};
