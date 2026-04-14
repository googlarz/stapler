import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { outputsApi } from "../api/outputs";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { BookOpen, Plus, CheckCircle2, Clock, Archive } from "lucide-react";

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  pending_approval: { label: "Pending approval", variant: "outline" },
  active: { label: "Active", variant: "default" },
  archived: { label: "Archived", variant: "secondary" },
};

export function Outputs() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    setBreadcrumbs([{ label: "Outputs" }]);
  }, [setBreadcrumbs]);

  const { data: outputs, isLoading, error } = useQuery({
    queryKey: queryKeys.outputs.list(selectedCompanyId!),
    queryFn: () => outputsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const propose = useMutation({
    mutationFn: (data: { title: string; description?: string }) =>
      outputsApi.propose(selectedCompanyId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.outputs.list(selectedCompanyId!) });
      setDialogOpen(false);
      setTitle("");
      setDescription("");
    },
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={BookOpen} message="Select a company to view outputs." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {outputs && outputs.length === 0 && (
        <EmptyState
          icon={BookOpen}
          message="No outputs yet. Propose the first one — a book, a report, a strategy doc."
          action="Propose Output"
          onAction={() => setDialogOpen(true)}
        />
      )}

      {outputs && outputs.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">Outputs</h1>
            <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Propose Output
            </Button>
          </div>

          <div className="space-y-2">
            {outputs.map((output) => {
              const badge = STATUS_BADGE[output.status] ?? STATUS_BADGE.pending_approval;
              return (
                <Link
                  key={output.id}
                  to={`/outputs/${output.id}`}
                  className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{output.title}</p>
                      {output.description && (
                        <p className="text-xs text-muted-foreground truncate">{output.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    {output.latestVersionNumber > 0 && (
                      <span className="text-xs text-muted-foreground">
                        v{output.latestVersionNumber}
                      </span>
                    )}
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Propose Output</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="output-title">Title</Label>
              <Input
                id="output-title"
                placeholder="e.g. Book — English, Go-to-Market Strategy"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && title.trim()) {
                    propose.mutate({ title: title.trim(), description: description.trim() || undefined });
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="output-desc">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                id="output-desc"
                placeholder="What is this output for? Who will read it?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              The CEO will receive an approval issue before agents can start working on this output.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() =>
                propose.mutate({ title: title.trim(), description: description.trim() || undefined })
              }
              disabled={!title.trim() || propose.isPending}
            >
              {propose.isPending ? "Proposing…" : "Propose"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
