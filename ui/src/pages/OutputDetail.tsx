import { useEffect, useState } from "react";
import { useParams, useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { outputsApi, type OutputVersion } from "../api/outputs";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, Tag, History, Pencil, Trash2, BookOpen } from "lucide-react";

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  pending_approval: { label: "Pending approval", variant: "outline" },
  active: { label: "Active", variant: "default" },
  archived: { label: "Archived", variant: "secondary" },
};

export function OutputDetail() {
  const { outputId } = useParams<{ outputId: string }>();
  const navigate = useNavigate();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [draftValue, setDraftValue] = useState<string | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [releaseNotes, setReleaseNotes] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const { data: output, isLoading, error } = useQuery({
    queryKey: queryKeys.outputs.detail(outputId!),
    queryFn: () => outputsApi.get(outputId!),
    enabled: !!outputId,
  });

  useEffect(() => {
    if (output) {
      setBreadcrumbs([
        { label: "Outputs", href: "/outputs" },
        { label: output.title },
      ]);
      if (draftValue === null) {
        setDraftValue(output.draftContent);
      }
    }
  }, [output, setBreadcrumbs]);

  const saveDraft = useMutation({
    mutationFn: (content: string) => outputsApi.updateDraft(outputId!, content),
    onSuccess: () => {
      setDraftDirty(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.outputs.detail(outputId!) });
    },
  });

  const approve = useMutation({
    mutationFn: () => outputsApi.approve(outputId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.outputs.detail(outputId!) }),
  });

  const releaseVersion = useMutation({
    mutationFn: (notes: string) => outputsApi.releaseVersion(outputId!, notes || undefined),
    onSuccess: () => {
      setReleaseDialogOpen(false);
      setReleaseNotes("");
      queryClient.invalidateQueries({ queryKey: queryKeys.outputs.detail(outputId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.outputs.list(output!.companyId) });
    },
  });

  const remove = useMutation({
    mutationFn: () => outputsApi.remove(outputId!),
    onSuccess: () => navigate("/outputs"),
  });

  if (isLoading) return <PageSkeleton variant="detail" />;
  if (error || !output) {
    return <p className="text-sm text-destructive p-4">Output not found.</p>;
  }

  const badge = STATUS_BADGE[output.status] ?? STATUS_BADGE.pending_approval;
  const currentDraft = draftValue ?? output.draftContent;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <BookOpen className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold truncate">{output.title}</h1>
            {output.description && (
              <p className="text-sm text-muted-foreground mt-0.5">{output.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={badge.variant}>{badge.label}</Badge>

          {output.status === "pending_approval" && (
            <Button size="sm" onClick={() => approve.mutate()} disabled={approve.isPending}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              {approve.isPending ? "Approving…" : "Approve"}
            </Button>
          )}

          {output.status === "active" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReleaseDialogOpen(true)}
              disabled={!currentDraft.trim()}
            >
              <Tag className="h-3.5 w-3.5 mr-1.5" />
              Release v{output.latestVersionNumber + 1}
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="draft">
        <TabsList>
          <TabsTrigger value="draft">
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            Draft
          </TabsTrigger>
          <TabsTrigger value="versions">
            <History className="h-3.5 w-3.5 mr-1.5" />
            Versions
            {output.latestVersionNumber > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                ({output.latestVersionNumber})
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Draft tab */}
        <TabsContent value="draft" className="mt-4 space-y-3">
          {output.status === "pending_approval" && (
            <p className="text-sm text-muted-foreground border border-border rounded-md px-3 py-2 bg-muted/30">
              This output is pending CEO approval. Once approved, agents can collaborate on the draft.
            </p>
          )}
          <Textarea
            value={currentDraft}
            onChange={(e) => {
              setDraftValue(e.target.value);
              setDraftDirty(e.target.value !== output.draftContent);
            }}
            placeholder="Start writing… Markdown is supported."
            className="min-h-[400px] font-mono text-sm resize-y"
            disabled={output.status !== "active"}
          />
          {draftDirty && (
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraftValue(output.draftContent);
                  setDraftDirty(false);
                }}
              >
                Discard
              </Button>
              <Button
                size="sm"
                onClick={() => saveDraft.mutate(currentDraft)}
                disabled={saveDraft.isPending}
              >
                {saveDraft.isPending ? "Saving…" : "Save draft"}
              </Button>
            </div>
          )}
        </TabsContent>

        {/* Versions tab */}
        <TabsContent value="versions" className="mt-4">
          {output.versions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No versions released yet. Write something in the draft and release v1.
            </p>
          ) : (
            <div className="space-y-4">
              {[...output.versions].reverse().map((v: OutputVersion) => (
                <div key={v.id} className="rounded-lg border border-border bg-card">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-xs">
                        v{v.versionNumber}
                      </Badge>
                      {v.releaseNotes && (
                        <span className="text-sm text-muted-foreground">{v.releaseNotes}</span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(v.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <pre className="px-4 py-3 text-sm font-mono whitespace-pre-wrap text-muted-foreground max-h-64 overflow-y-auto">
                    {v.content || <em>Empty</em>}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete output?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete <strong>{output.title}</strong> and all its versions.
            This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Release version dialog */}
      <Dialog open={releaseDialogOpen} onOpenChange={setReleaseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Release v{output.latestVersionNumber + 1}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="release-notes">Release notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="release-notes"
                placeholder="What changed in this version?"
                value={releaseNotes}
                onChange={(e) => setReleaseNotes(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") releaseVersion.mutate(releaseNotes);
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              The current draft will be snapshotted as v{output.latestVersionNumber + 1}. The draft
              will continue to evolve — nothing is locked.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReleaseDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => releaseVersion.mutate(releaseNotes)}
              disabled={releaseVersion.isPending}
            >
              {releaseVersion.isPending ? "Releasing…" : `Release v${output.latestVersionNumber + 1}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
