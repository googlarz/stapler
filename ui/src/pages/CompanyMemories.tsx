import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Brain, Trash2, Plus } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { companyMemoriesApi, type CompanyMemory } from "../api/companyMemories";
import { queryKeys } from "../lib/queryKeys";
import { relativeTime } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function MemoryRow({
  memory,
  onDelete,
  deleting,
}: {
  memory: CompanyMemory;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0 group">
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm whitespace-pre-wrap break-words">{memory.content}</p>
        <div className="flex items-center gap-2 flex-wrap">
          {memory.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0">
              {tag}
            </Badge>
          ))}
          <span className="text-xs text-muted-foreground">
            {relativeTime(memory.createdAt)}
            {memory.contentBytes > 0 && ` · ${memory.contentBytes}B`}
          </span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
        onClick={onDelete}
        disabled={deleting}
        title="Delete memory"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function AddMemoryDialog({
  companyId,
  open,
  onOpenChange,
}: {
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [rawTags, setRawTags] = useState("");

  const createMutation = useMutation({
    mutationFn: () => {
      const tags = rawTags
        .split(/[,\s]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      return companyMemoriesApi.create(companyId, {
        content: content.trim(),
        tags: tags.length > 0 ? tags : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies", companyId, "memories"] });
      setContent("");
      setRawTags("");
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add company memory</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Content</label>
            <Textarea
              placeholder="Enter the shared knowledge, convention, or preference to remember…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="resize-none min-h-[100px]"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Tags <span className="text-muted-foreground font-normal">(optional, comma-separated)</span>
            </label>
            <Input
              placeholder="e.g. style, vendors, decisions"
              value={rawTags}
              onChange={(e) => setRawTags(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!content.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Saving…" : "Save memory"}
            </Button>
          </div>
          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {createMutation.error instanceof Error
                ? createMutation.error.message
                : "Failed to save memory"}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CompanyMemories() {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const [rawTags, setRawTags] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const tags = useMemo(() => {
    const parts = rawTags
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    return parts.length > 0 ? parts : null;
  }, [rawTags]);

  const memoriesQuery = useQuery({
    queryKey: queryKeys.companies.memories(selectedCompanyId!, tags),
    queryFn: () =>
      companyMemoriesApi.list(selectedCompanyId!, {
        tags: tags ?? undefined,
        limit: 100,
      }),
    enabled: !!selectedCompanyId,
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => companyMemoriesApi.remove(selectedCompanyId!, id),
    onSettled: () => setDeletingId(null),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["companies", selectedCompanyId, "memories"],
      });
    },
  });

  const items = memoriesQuery.data?.items ?? [];

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Company memories</h1>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add memory
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Shared knowledge available to all agents — preferred vendors, style
        conventions, recurring decisions. Agents with{" "}
        <code className="text-xs bg-muted px-1 rounded">enableMemoryInjection</code>{" "}
        enabled receive relevant entries automatically at run-start.
      </p>

      <Input
        type="search"
        placeholder="Filter by tag…"
        value={rawTags}
        onChange={(e) => setRawTags(e.target.value)}
        className="max-w-xs"
        aria-label="Filter memories by tag"
      />

      {memoriesQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {tags ? "No memories match these tags." : "No company memories yet."}
        </p>
      ) : (
        <div>
          <p className="text-xs text-muted-foreground mb-2">
            {items.length} {items.length === 1 ? "memory" : "memories"}
          </p>
          <div className="border border-border rounded-md px-3">
            {items.map((memory) => (
              <MemoryRow
                key={memory.id}
                memory={memory}
                deleting={deletingId === memory.id}
                onDelete={() => {
                  setDeletingId(memory.id);
                  removeMutation.mutate(memory.id);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {selectedCompanyId && (
        <AddMemoryDialog
          companyId={selectedCompanyId}
          open={addOpen}
          onOpenChange={setAddOpen}
        />
      )}
    </div>
  );
}
