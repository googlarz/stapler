import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import type {
  AgentMemory,
  AgentMemorySearchResult,
} from "@paperclipai/shared";
import { agentMemoriesApi } from "../api/agentMemories";
import { queryKeys } from "../lib/queryKeys";
import { relativeTime } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  agentId: string;
}

function isSearchResult(
  row: AgentMemory | AgentMemorySearchResult,
): row is AgentMemorySearchResult {
  return typeof (row as AgentMemorySearchResult).score === "number";
}

/**
 * Read-only (plus delete) panel for an agent's memories. Lets board
 * users inspect what the agent has remembered, filter by tag, do
 * keyword search, and delete stale rows. Create is intentionally
 * not exposed from the UI — memories are the agent's own working
 * notes, not something a human should seed.
 */
export function AgentMemoryList({ agentId }: Props) {
  const queryClient = useQueryClient();
  const [rawQuery, setRawQuery] = useState("");
  const [rawTags, setRawTags] = useState("");

  // Parse the (comma- or whitespace-separated) tag input into a clean array.
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
    queryKey: queryKeys.agents.memories(agentId, effectiveQuery, tags),
    queryFn: () =>
      agentMemoriesApi.list(agentId, {
        q: effectiveQuery ?? undefined,
        tags: tags ?? undefined,
        limit: 50,
      }),
  });

  const removeMutation = useMutation({
    mutationFn: (memoryId: string) => agentMemoriesApi.remove(agentId, memoryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", agentId, "memories"] });
    },
  });

  const items = memoriesQuery.data?.items ?? [];

  return (
    <div className="space-y-4 max-w-3xl">
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
            placeholder="Filter by tag, tag…"
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
          Agents save short notes here to recall across runs. Keyword search
          uses trigram similarity; search ranks by relevance, list is
          newest-first.
        </p>
      </div>

      {memoriesQuery.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {memoriesQuery.isError && (
        <p className="text-sm text-destructive">
          Couldn't load memories: {(memoriesQuery.error as Error).message}
        </p>
      )}

      {!memoriesQuery.isLoading && !memoriesQuery.isError && items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {effectiveQuery || tags
            ? "No memories matched the current filter."
            : "No memories saved yet. This agent has not recorded anything."}
        </p>
      )}

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((memory) => (
            <li
              key={memory.id}
              className="rounded-md border border-border p-3 text-sm space-y-2"
              data-testid={`agent-memory-row-${memory.id}`}
            >
              <p className="whitespace-pre-wrap break-words">{memory.content}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {memory.tags.length > 0 &&
                  memory.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                    >
                      {tag}
                    </span>
                  ))}
                <span>{relativeTime(memory.createdAt)}</span>
                {isSearchResult(memory) && (
                  <span title="pg_trgm similarity score">
                    score {memory.score.toFixed(2)}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => {
                    if (window.confirm("Delete this memory? This cannot be undone.")) {
                      removeMutation.mutate(memory.id);
                    }
                  }}
                  title="Delete memory"
                  className="ml-auto"
                  disabled={removeMutation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
