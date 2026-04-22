import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Plus, Trash2, Play, CheckCircle2, XCircle, AlertCircle, Clock, Loader2 } from "lucide-react";
import { evalsApi, type EvalCase, type EvalRun } from "../api/evals";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { useParams } from "@/lib/router";

const STATUS_ICON: Record<string, React.ReactNode> = {
  passed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-destructive" />,
  error: <AlertCircle className="h-4 w-4 text-yellow-500" />,
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />,
};

function scoreColor(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 0.8) return "text-green-600";
  if (score >= 0.5) return "text-yellow-600";
  return "text-destructive";
}

export function EvalSuiteDetail() {
  const { suiteId } = useParams<{ suiteId: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [showAddCase, setShowAddCase] = useState(false);
  const [caseName, setCaseName] = useState("");
  const [caseTask, setCaseTask] = useState("");
  const [caseCriteria, setCaseCriteria] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data: suite, isLoading } = useQuery({
    queryKey: queryKeys.evals.suite(suiteId ?? ""),
    queryFn: () => evalsApi.getSuite(suiteId!),
    enabled: !!suiteId,
  });

  const { data: runsData } = useQuery({
    queryKey: queryKeys.evals.runs(selectedCompanyId ?? ""),
    queryFn: () => evalsApi.listRuns(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const suiteRuns = (runsData?.items ?? []).filter((r) => r.suiteId === suiteId);

  const { data: runDetail } = useQuery({
    queryKey: queryKeys.evals.run(selectedRunId ?? ""),
    queryFn: () => evalsApi.getRun(selectedRunId!),
    enabled: !!selectedRunId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "pending" ? 3000 : false;
    },
  });

  useEffect(() => {
    if (suite) {
      setBreadcrumbs([
        { label: "Evals", href: "/evals" },
        { label: suite.name },
      ]);
    }
  }, [suite, setBreadcrumbs]);

  const createCaseMutation = useMutation({
    mutationFn: () =>
      evalsApi.createCase(suiteId!, {
        name: caseName.trim(),
        inputJson: { task: caseTask.trim() },
        criteria: caseCriteria.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.evals.suite(suiteId!) });
      setShowAddCase(false);
      setCaseName("");
      setCaseTask("");
      setCaseCriteria("");
    },
  });

  const deleteCaseMutation = useMutation({
    mutationFn: (caseId: string) => evalsApi.deleteCase(suiteId!, caseId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.evals.suite(suiteId!) });
    },
  });

  const triggerRunMutation = useMutation({
    mutationFn: () => evalsApi.triggerRun(suiteId!),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.evals.runs(selectedCompanyId!) });
      setSelectedRunId(run.id);
    },
  });

  if (isLoading || !suite) return <PageSkeleton variant="detail" />;

  const cases: EvalCase[] = suite.cases ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-muted-foreground" />
            {suite.name}
          </h1>
          {suite.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{suite.description}</p>
          )}
        </div>
        <Button
          size="sm"
          onClick={() => triggerRunMutation.mutate()}
          disabled={cases.length === 0 || triggerRunMutation.isPending}
        >
          <Play className="h-3.5 w-3.5 mr-1.5" />
          Run All
        </Button>
      </div>

      {/* Test Cases */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Test Cases ({cases.length})
          </h2>
          <Button size="sm" variant="outline" onClick={() => setShowAddCase((v) => !v)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Case
          </Button>
        </div>

        {showAddCase && (
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <input
              className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
              placeholder="Case name"
              value={caseName}
              onChange={(e) => setCaseName(e.target.value)}
            />
            <textarea
              className="w-full rounded border border-input bg-background px-2 py-1 text-sm resize-none"
              placeholder="Task / wakeup context (what the agent should do)"
              rows={3}
              value={caseTask}
              onChange={(e) => setCaseTask(e.target.value)}
            />
            <textarea
              className="w-full rounded border border-input bg-background px-2 py-1 text-sm resize-none"
              placeholder="Scoring criteria (describe what a passing response looks like)"
              rows={3}
              value={caseCriteria}
              onChange={(e) => setCaseCriteria(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => createCaseMutation.mutate()}
                disabled={!caseName.trim() || !caseCriteria.trim() || createCaseMutation.isPending}
              >
                Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAddCase(false)}>
                Cancel
              </Button>
            </div>
            {createCaseMutation.error && (
              <p className="text-xs text-destructive">{createCaseMutation.error.message}</p>
            )}
          </div>
        )}

        {cases.length === 0 && !showAddCase && (
          <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed border-border">
            No test cases yet. Add one to define what to evaluate.
          </p>
        )}

        {cases.length > 0 && (
          <div className="divide-y divide-border rounded-lg border border-border bg-card">
            {cases.map((c) => (
              <div key={c.id} className="flex items-start justify-between px-4 py-3 gap-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground line-clamp-1">
                    Task: {(c.inputJson?.task as string) ?? "(custom context)"}
                  </p>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    Criteria: {c.criteria}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive shrink-0"
                  onClick={() => {
                    if (confirm(`Delete case "${c.name}"?`)) {
                      deleteCaseMutation.mutate(c.id);
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Run History */}
      {suiteRuns.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Run History
          </h2>
          <div className="divide-y divide-border rounded-lg border border-border bg-card">
            {suiteRuns.map((run) => (
              <button
                key={run.id}
                className={`w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors ${selectedRunId === run.id ? "bg-muted/50" : ""}`}
                onClick={() => setSelectedRunId(selectedRunId === run.id ? null : run.id)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {STATUS_ICON[run.status] ?? <Clock className="h-4 w-4 text-muted-foreground" />}
                  <span className="text-sm font-mono text-muted-foreground truncate">
                    {run.id.slice(0, 8)}…
                  </span>
                  <span className="text-xs text-muted-foreground capitalize">{run.status}</span>
                </div>
                {run.summaryJson && (
                  <span className={`text-sm font-medium tabular-nums ${scoreColor(run.summaryJson.avgScore)}`}>
                    {Math.round(run.summaryJson.avgScore * 100)}%
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      ({run.summaryJson.passed}/{run.summaryJson.passed + run.summaryJson.failed + run.summaryJson.errors})
                    </span>
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Run detail */}
          {selectedRunId && runDetail && (
            <div className="rounded-lg border border-border bg-card divide-y divide-border">
              {runDetail.results.map((result) => {
                const evalCase = cases.find((c) => c.id === result.caseId);
                return (
                  <div key={result.id} className="px-4 py-3 space-y-1">
                    <div className="flex items-center gap-2">
                      {STATUS_ICON[result.status] ?? <Clock className="h-4 w-4" />}
                      <span className="text-sm font-medium">
                        {evalCase?.name ?? result.caseId.slice(0, 8)}
                      </span>
                      {result.score !== null && (
                        <span className={`ml-auto text-sm font-medium tabular-nums ${scoreColor(result.score)}`}>
                          {Math.round(result.score * 100)}%
                        </span>
                      )}
                    </div>
                    {result.judgeOutput && (
                      <p className="text-xs text-muted-foreground pl-6">{result.judgeOutput}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
