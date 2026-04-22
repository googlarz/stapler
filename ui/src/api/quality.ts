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

export const qualityApi = {
  runScore: (runId: string) => api.get<RunScoreRow>(`/runs/${runId}/score`),
  agentTrend: (agentId: string, limit = 20) =>
    api.get<AgentQualityTrend>(`/agents/${agentId}/quality/trend?limit=${limit}`),
  companyTrend: (companyId: string) =>
    api.get<CompanyQualityTrend>(`/companies/${companyId}/quality/trend`),
  companyRecent: (companyId: string, limit = 50) =>
    api.get<{ items: CompanyRecentScore[] }>(`/companies/${companyId}/quality/recent?limit=${limit}`),
};
