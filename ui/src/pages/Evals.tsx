import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Plus, Trash2, Play, ChevronRight } from "lucide-react";
import { evalsApi, type EvalSuite } from "../api/evals";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";

export function Evals() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAgentId, setNewAgentId] = useState("");
  const [newDescription, setNewDescription] = useState("");

  useEffect(() => {
    setBreadcrumbs([{ label: "Evals" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.evals.suites(selectedCompanyId ?? ""),
    queryFn: () => evalsApi.listSuites(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      evalsApi.createSuite(selectedCompanyId!, {
        agentId: newAgentId.trim(),
        name: newName.trim(),
        description: newDescription.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.evals.suites(selectedCompanyId!) });
      setShowCreate(false);
      setNewName("");
      setNewAgentId("");
      setNewDescription("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (suiteId: string) => evalsApi.deleteSuite(suiteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.evals.suites(selectedCompanyId!) });
    },
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={FlaskConical} message="Select a company to view eval suites." />;
  }
  if (isLoading) return <PageSkeleton variant="list" />;

  const suites: EvalSuite[] = data?.items ?? [];

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Eval Suites</h1>
        <Button size="sm" variant="outline" onClick={() => setShowCreate((v) => !v)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New Suite
        </Button>
      </div>

      {showCreate && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-medium">Create Eval Suite</h2>
          <div className="space-y-2">
            <input
              className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
              placeholder="Suite name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              className="w-full rounded border border-input bg-background px-2 py-1 text-sm font-mono"
              placeholder="Agent ID (UUID)"
              value={newAgentId}
              onChange={(e) => setNewAgentId(e.target.value)}
            />
            <input
              className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
              placeholder="Description (optional)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim() || !newAgentId.trim() || createMutation.isPending}
            >
              Create
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
          </div>
          {createMutation.error && (
            <p className="text-xs text-destructive">{createMutation.error.message}</p>
          )}
        </div>
      )}

      {suites.length === 0 && !showCreate && (
        <EmptyState
          icon={FlaskConical}
          message="No eval suites yet. Create one to start testing your agents."
          action="New Suite"
          onAction={() => setShowCreate(true)}
        />
      )}

      {suites.length > 0 && (
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {suites.map((suite) => (
            <div key={suite.id} className="flex items-center justify-between px-4 py-3">
              <Link
                to={`/evals/${suite.id}`}
                className="flex items-center gap-2 hover:text-primary min-w-0"
              >
                <FlaskConical className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{suite.name}</p>
                  {suite.description && (
                    <p className="text-xs text-muted-foreground truncate">{suite.description}</p>
                  )}
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-1" />
              </Link>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive ml-2 shrink-0"
                onClick={() => {
                  if (confirm(`Delete suite "${suite.name}"?`)) {
                    deleteMutation.mutate(suite.id);
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
