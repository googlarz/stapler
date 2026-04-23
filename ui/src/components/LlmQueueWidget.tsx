/**
 * LlmQueueWidget — compact LLM inference queue monitor.
 *
 * Shows how many Ollama slots are running and waiting.
 * Polls every 4 seconds when there is queue activity so operators can
 * see the queue drain in near-real-time without full page refresh.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { qualityApi } from "../api/quality";
import { cn } from "../lib/utils";
import { Cpu } from "lucide-react";

const POLL_IDLE_MS = 15_000;    // slow poll when nothing is queued
const POLL_ACTIVE_MS = 4_000;   // fast poll when agents are waiting

export function LlmQueueWidget() {
  const [pollInterval, setPollInterval] = useState(POLL_IDLE_MS);

  const { data } = useQuery({
    queryKey: ["llm-queue-stats"],
    queryFn: () => qualityApi.llmQueueStats(),
    refetchInterval: pollInterval,
    staleTime: 0,
  });

  // Aggregate across all endpoints
  const totalRunning = data?.endpoints.reduce((s, e) => s + e.running, 0) ?? 0;
  const totalQueued = data?.endpoints.reduce((s, e) => s + e.queued, 0) ?? 0;
  const totalConcurrency = data?.endpoints.reduce((s, e) => s + e.concurrency, 0) ?? 0;

  // Switch to fast polling when agents are waiting
  useEffect(() => {
    setPollInterval(totalQueued > 0 ? POLL_ACTIVE_MS : POLL_IDLE_MS);
  }, [totalQueued]);

  if (totalRunning === 0 && totalQueued === 0) return null;

  const highQueued = data?.endpoints.reduce((s, e) => s + e.queueByPriority.high, 0) ?? 0;
  const normalQueued = data?.endpoints.reduce((s, e) => s + e.queueByPriority.normal, 0) ?? 0;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded border px-2 py-1 text-xs tabular-nums",
        totalQueued > 0
          ? "border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
      title={[
        `Ollama: ${totalRunning}/${totalConcurrency} running`,
        totalQueued > 0 ? `${totalQueued} waiting in queue` : null,
        highQueued > 0 ? `  · ${highQueued} high-priority` : null,
        normalQueued > 0 ? `  · ${normalQueued} normal` : null,
      ]
        .filter(Boolean)
        .join("\n")}
    >
      <Cpu className="h-3 w-3 shrink-0" />
      <span>
        {totalRunning}/{totalConcurrency}
        {totalQueued > 0 && (
          <span className="ml-1 font-medium">+{totalQueued} waiting</span>
        )}
      </span>
    </div>
  );
}
