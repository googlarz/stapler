import { api } from "./client";

export interface EvalSuite {
  id: string;
  companyId: string;
  agentId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvalCase {
  id: string;
  suiteId: string;
  name: string;
  inputJson: Record<string, unknown>;
  criteria: string;
  expectedTags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EvalSuiteWithCases extends EvalSuite {
  cases: EvalCase[];
}

export interface EvalRunSummary {
  passed: number;
  failed: number;
  errors: number;
  avgScore: number;
}

export interface EvalRun {
  id: string;
  suiteId: string;
  triggeredBy: string;
  status: "pending" | "running" | "done" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  summaryJson: EvalRunSummary | null;
  createdAt: string;
  // populated by list endpoint
  suiteName?: string;
  agentId?: string;
}

export interface EvalCaseResult {
  id: string;
  runId: string;
  caseId: string;
  heartbeatRunId: string | null;
  status: "pending" | "running" | "passed" | "failed" | "error";
  score: number | null;
  judgeOutput: string | null;
  stdoutExcerpt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvalRunWithResults extends EvalRun {
  results: EvalCaseResult[];
}

export const evalsApi = {
  // Suites
  listSuites: (companyId: string) =>
    api.get<{ items: EvalSuite[] }>(`/companies/${companyId}/eval-suites`),

  createSuite: (companyId: string, data: { agentId: string; name: string; description?: string }) =>
    api.post<EvalSuite>(`/companies/${companyId}/eval-suites`, data),

  getSuite: (id: string) => api.get<EvalSuiteWithCases>(`/eval-suites/${id}`),

  deleteSuite: (id: string) => api.delete<void>(`/eval-suites/${id}`),

  // Cases
  createCase: (
    suiteId: string,
    data: { name: string; inputJson?: Record<string, unknown>; criteria: string; expectedTags?: string[] },
  ) => api.post<EvalCase>(`/eval-suites/${suiteId}/cases`, data),

  deleteCase: (suiteId: string, caseId: string) =>
    api.delete<void>(`/eval-suites/${suiteId}/cases/${caseId}`),

  // Runs
  triggerRun: (suiteId: string, triggeredBy?: string) =>
    api.post<EvalRun>(`/eval-suites/${suiteId}/run`, { triggeredBy }),

  getRun: (id: string) => api.get<EvalRunWithResults>(`/eval-runs/${id}`),

  listRuns: (companyId: string) =>
    api.get<{ items: EvalRun[] }>(`/companies/${companyId}/eval-runs`),
};
