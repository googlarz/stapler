import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Brain, Trash2, Plus, BookOpen } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import {
  companyMemoriesApi,
  type CompanyMemory,
  type CompanyMemorySearchResult,
  type CompanyMemoryQueryResponse,
} from "../api/companyMemories";
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

function isSearchResult(row: CompanyMemory | CompanyMemorySearchResult): row is CompanyMemorySearchResult {
  return typeof (row as CompanyMemorySearchResult).score === "number";
}

function MemoryRow({
  memory,
  onDelete,
  deleting,
}: {
  memory: CompanyMemory | CompanyMemorySearchResult;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0 group">
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm whitespace-pre-wrap break-words">{memory.content}</p>
        <div className="flex items-center gap-2 flex-wrap">
          {memory.wikiSlug && (
            <span className="rounded bg-primary/10 text-primary px-1.5 py-0.5 font-mono text-[10px]">
              wiki:{memory.wikiSlug}
            </span>
          )}
          {memory.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0">
              {tag}
            </Badge>
          ))}
          <span className="text-xs text-muted-foreground">
            {relativeTime(memory.createdAt)}
            {memory.contentBytes > 0 && ` · ${memory.contentBytes}B`}
          </span>
          {isSearchResult(memory) && (
            <span className="text-xs text-muted-foreground" title="pg_trgm similarity score">
              score {memory.score.toFixed(2)}
            </span>
          )}
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

/** Format a Date as a `datetime-local` input value (YYYY-MM-DDTHH:MM). */
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const [expiresAt, setExpiresAt] = useState("");

  const createMutation = useMutation({
    mutationFn: () => {
      const tags = rawTags
        .split(/[,\s]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      return companyMemoriesApi.create(companyId, {
        content: content.trim(),
        tags: tags.length > 0 ? tags : undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies", companyId, "memories"] });
      setContent("");
      setRawTags("");
      setExpiresAt("");
      onOpenChange(false);
    },
  });

  // Min datetime = now + 1 min, formatted for datetime-local
  const minDatetime = toDatetimeLocal(new Date(Date.now() + 60_000));

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
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Expires at <span className="text-muted-foreground font-normal">(optional — leave blank to keep forever)</span>
            </label>
            <Input
              type="datetime-local"
              value={expiresAt}
              min={minDatetime}
              onChange={(e) => setExpiresAt(e.target.value)}
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

/** Slug must start with a lowercase letter or digit, then lowercase alphanumeric / hyphens / underscores. */
const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

function AddWikiPageDialog({
  companyId,
  open,
  onOpenChange,
}: {
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [slug, setSlug] = useState("");
  const [content, setContent] = useState("");
  const [rawTags, setRawTags] = useState("");

  const slugError =
    slug.length > 0 && !SLUG_RE.test(slug)
      ? "Slug must be lowercase: letters, digits, hyphens, underscores; start with a letter or digit."
      : null;

  const upsertMutation = useMutation({
    mutationFn: () => {
      const tags = rawTags
        .split(/[,\s]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      return companyMemoriesApi.wikiUpsert(companyId, slug.trim(), {
        content: content.trim(),
        tags: tags.length > 0 ? tags : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies", companyId, "memories"] });
      setSlug("");
      setContent("");
      setRawTags("");
      onOpenChange(false);
    },
  });

  const canSubmit = slug.trim().length > 0 && !slugError && content.trim().length > 0 && !upsertMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add wiki page</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Slug <span className="text-muted-foreground font-normal">(unique identifier, e.g. tech-stack)</span>
            </label>
            <Input
              placeholder="tech-stack"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              maxLength={64}
              autoFocus
            />
            {slugError && <p className="text-xs text-destructive">{slugError}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Content</label>
            <Textarea
              placeholder="Describe this knowledge page in detail…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="resize-none min-h-[120px]"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Tags <span className="text-muted-foreground font-normal">(optional, comma-separated)</span>
            </label>
            <Input
              placeholder="e.g. architecture, style"
              value={rawTags}
              onChange={(e) => setRawTags(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!canSubmit} onClick={() => upsertMutation.mutate()}>
              {upsertMutation.isPending ? "Saving…" : "Save wiki page"}
            </Button>
          </div>
          {upsertMutation.isError && (
            <p className="text-sm text-destructive">
              {upsertMutation.error instanceof Error
                ? upsertMutation.error.message
                : "Failed to save wiki page"}
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
  const [rawQuery, setRawQuery] = useState("");
  const [rawTags, setRawTags] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addWikiOpen, setAddWikiOpen] = useState(false);

  const tags = useMemo(() => {
    const parts = rawTags
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    return parts.length > 0 ? parts : null;
  }, [rawTags]);

  const trimmedQuery = rawQuery.trim();
  const effectiveQuery = trimmedQuery.length > 0 ? trimmedQuery : null;

  const memoriesQuery = useQuery({
    queryKey: queryKeys.companies.memories(selectedCompanyId!, effectiveQuery, tags),
    queryFn: () =>
      companyMemoriesApi.list(selectedCompanyId!, {
        q: effectiveQuery ?? undefined,
        tags: tags ?? undefined,
        limit: 100,
      }),
    enabled: !!selectedCompanyId,
  });

  const statsQuery = useQuery({
    queryKey: queryKeys.companies.memoriesStats(selectedCompanyId!),
    queryFn: () => companyMemoriesApi.stats(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => companyMemoriesApi.remove(selectedCompanyId!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies", selectedCompanyId, "memories"] });
    },
  });

  const wikiRemoveMutation = useMutation({
    mutationFn: (slug: string) => companyMemoriesApi.wikiRemoveBySlug(selectedCompanyId!, slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies", selectedCompanyId, "memories"] });
    },
  });

  const response = memoriesQuery.data as CompanyMemoryQueryResponse | undefined;
  const allItems = response?.items ?? [];
  const wikiItems = allItems.filter((m) => m.wikiSlug);
  const episodicItems = allItems.filter((m) => !m.wikiSlug);
  const stats = statsQuery.data;

  function handleDelete(memory: CompanyMemory) {
    const isWiki = !!memory.wikiSlug;
    const msg = isWiki
      ? `Delete wiki page "${memory.wikiSlug}"? This cannot be undone.`
      : "Delete this memory? This cannot be undone.";
    if (!window.confirm(msg)) return;
    if (isWiki && memory.wikiSlug) {
      wikiRemoveMutation.mutate(memory.wikiSlug);
    } else {
      removeMutation.mutate(memory.id);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Company memories</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setAddWikiOpen(true)}>
            <BookOpen className="h-3.5 w-3.5 mr-1.5" />
            Add wiki page
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add memory
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Shared knowledge available to all agents — preferred vendors, style
        conventions, recurring decisions. Agents with{" "}
        <code className="text-xs bg-muted px-1 rounded">enableMemoryInjection</code>{" "}
        enabled receive relevant entries automatically at run-start.
      </p>

      {/* Stats bar */}
      {stats && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground rounded-md border border-border bg-muted/30 px-3 py-2">
          <span>
            <span className="font-medium text-foreground">{stats.episodic.count}</span>
            {" episodic"}
          </span>
          <span className="text-border">·</span>
          <span>
            <span className="font-medium text-foreground">{stats.wiki.count}</span>
            {" wiki pages"}
          </span>
          <span className="text-border">·</span>
          <span>
            {(stats.total.bytes / 1024).toFixed(1)}
            {" KB stored"}
          </span>
        </div>
      )}

      {/* Search + tag filter */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Input
            type="search"
            placeholder="Search memories (keyword)…"
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            className="max-w-md"
            aria-label="Search memories"
          />
          <Input
            type="text"
            placeholder="Filter by tag…"
            value={rawTags}
            onChange={(e) => setRawTags(e.target.value)}
            className="max-w-xs"
            aria-label="Filter by tags"
          />
          {(rawQuery || rawTags) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRawQuery("");
                setRawTags("");
              }}
            >
              Clear
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Keyword search uses trigram similarity; search ranks by relevance, list is newest-first.
        </p>
      </div>

      {memoriesQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : memoriesQuery.isError ? (
        <p className="text-sm text-destructive">
          Couldn't load memories: {(memoriesQuery.error as Error).message}
        </p>
      ) : allItems.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {effectiveQuery || tags
            ? "No memories matched the current filter."
            : "No company memories yet."}
        </p>
      ) : (
        <div className="space-y-4">
          {/* Knowledge base (wiki pages) */}
          {wikiItems.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Knowledge base
              </h3>
              <div className="border border-border rounded-md px-3">
                {wikiItems.map((memory) => (
                  <MemoryRow
                    key={memory.id}
                    memory={memory}
                    deleting={wikiRemoveMutation.isPending}
                    onDelete={() => handleDelete(memory)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Episodic memories */}
          {episodicItems.length > 0 && (
            <div className="space-y-1">
              {wikiItems.length > 0 && (
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Memories
                </h3>
              )}
              <p className="text-xs text-muted-foreground">
                {episodicItems.length} {episodicItems.length === 1 ? "memory" : "memories"}
              </p>
              <div className="border border-border rounded-md px-3">
                {episodicItems.map((memory) => (
                  <MemoryRow
                    key={memory.id}
                    memory={memory}
                    deleting={removeMutation.isPending}
                    onDelete={() => handleDelete(memory)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {selectedCompanyId && (
        <>
          <AddMemoryDialog
            companyId={selectedCompanyId}
            open={addOpen}
            onOpenChange={setAddOpen}
          />
          <AddWikiPageDialog
            companyId={selectedCompanyId}
            open={addWikiOpen}
            onOpenChange={setAddWikiOpen}
          />
        </>
      )}
    </div>
  );
}
