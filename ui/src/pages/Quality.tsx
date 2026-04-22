/**
 * Quality Dashboard — Pillar 5 of the Quality Flywheel.
 *
 * Shows per-agent rolling quality scores, recent drift alerts,
 * and a timeline of recent scored runs.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingDown, TrendingUp, Minus, BarChart3 } from "lucide-react";
import { Link } from "@/lib/router";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { qualityApi } from "../api/quality";
import { agentsApi } from "../api/agents";
import { RunScoreBadge } from "../components/RunScoreBadge";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";

function ScoreTrend({ prev, curr }: { prev: number | null; curr: number | null }) {
  if (prev == null || curr == null) return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  const delta = curr - prev;
  if (delta > 0.02) return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />;
  if (delta < -0.02) return <TrendingDown className="h-3.5 w-3.5 text-rose-500" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

export function Quality() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Quality" }]);
  }, [setBreadcrumbs]);

  const { data: agentList, isLoading: agentsLoading } = useQuery({
    queryKey: ["agents", "list", selectedCompanyId],
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: companyTrend, isLoading: trendLoading } = useQuery({
    queryKey: ["quality", "companyTrend", selectedCompanyId],
    queryFn: () => qualityApi.companyTrend(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    staleTime: 30_000,
  });

  const { data: recentScores, isLoading: recentLoading } = useQuery({
    queryKey: ["quality", "companyRecent", selectedCompanyId],
    queryFn: () => qualityApi.companyRecent(selectedCompanyId!, 30),
    enabled: !!selectedCompanyId,
    staleTime: 30_000,
  });

  const isLoading = agentsLoading || trendLoading || recentLoading;

  if (isLoading) return <PageSkeleton />;

  const agentMap = Object.fromEntries((agentList ?? []).map((a) => [a.id, a]));
  const trendByAgent = Object.fromEntries(
    (companyTrend?.items ?? []).map((t) => [t.agentId, t])
  );

  const scoredAgentIds = new Set((companyTrend?.items ?? []).map((t) => t.agentId));

  return (
    <div className="space-y-8 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Quality</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            30-day rolling averages across all scored agents.
            Enable <code className="text-xs bg-muted px-1 py-0.5 rounded">autoScoreRuns</code> in an
            agent&rsquo;s adapter config to populate this dashboard.
          </p>
        </div>
        <BarChart3 className="h-6 w-6 text-muted-foreground" />
      </div>

      {/* Per-agent quality cards */}
      {scoredAgentIds.size === 0 ? (
        <EmptyState
          icon={BarChart3}
          message="No quality data yet. Set autoScoreRuns: true in an agent's adapter config — scores appear here after the first successful run."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(companyTrend?.items ?? [])
            .sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0))
            .map((item) => {
              const agent = agentMap[item.agentId];
              return (
                <div
                  key={item.agentId}
                  className="border border-border rounded-xl p-4 space-y-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Link
                        to={`/agents/${agent?.id ?? item.agentId}`}
                        className="text-sm font-medium hover:underline no-underline"
                      >
                        {agent?.name ?? item.agentId.slice(0, 8)}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {item.sampleSize} run{item.sampleSize !== 1 ? "s" : ""} scored ·{" "}
                        {companyTrend?.windowDays ?? 30}d
                      </p>
                    </div>
                    <RunScoreBadge score={item.avgScore} variant="full" />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ScoreTrend prev={null} curr={item.avgScore} />
                    <span>
                      Last scored:{" "}
                      {item.lastJudgedAt
                        ? new Date(item.lastJudgedAt).toLocaleDateString()
                        : "never"}
                    </span>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* Recent scored runs timeline */}
      {(recentScores?.items ?? []).length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium">Recent Scored Runs</h2>
          <div className="border border-border rounded-xl overflow-hidden divide-y divide-border">
            {(recentScores?.items ?? []).map((s) => {
              const agent = agentMap[s.agentId];
              return (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <RunScoreBadge score={s.score} reasoning={s.reasoning ?? undefined} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium truncate">
                        {agent?.name ?? s.agentId.slice(0, 8)}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {s.runId.slice(0, 8)}
                      </span>
                    </div>
                    {s.reasoning && (
                      <p className="text-xs text-muted-foreground truncate">{s.reasoning}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(s.judgedAt).toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
