/**
 * llm-queue.ts
 *
 * Priority-aware, fairness-capped process-wide semaphore for local LLM inference,
 * keyed by Ollama base URL.
 *
 * ## Why this exists
 * A single GPU can only run one forward pass at a time. Ollama serialises internally
 * but *drops* excess concurrent connections instead of queuing them, causing sporadic
 * "fetch failed" errors when multiple agents try to infer simultaneously. This module
 * provides the queuing layer that Ollama itself lacks.
 *
 * ## Priority levels
 *   2 = high   — CEO role, skill invocations (time-sensitive orchestration)
 *   1 = normal  — standard agent heartbeat runs
 *   0 = low    — eval/background tasks
 *
 * High-priority entries are served before normal, normal before low.
 * Within the same priority, arrival order (FIFO) is preserved.
 *
 * ## Per-agent fairness cap
 * No single agent can monopolise the queue. If an agent already has
 * `maxQueuedPerAgent` entries waiting (default 2), the next attempt throws
 * `LlmQueueFullError` immediately rather than piling on indefinitely.
 *
 * ## Usage
 *   const release = await acquireLlmSlot(baseUrl, { priority: 2, agentId: agent.id, signal });
 *   try { ... await ollama.chat(...) ... }
 *   finally { release(); }
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Priority level for queue ordering. Higher = served first. */
export type LlmPriority = 0 | 1 | 2;

export interface LlmSlotOptions {
  /** Max simultaneous inference calls against this URL. Default 1. */
  concurrency?: number;
  /** Queue priority. 2=high (CEO/skill), 1=normal, 0=low (background). Default 1. */
  priority?: LlmPriority;
  /** Agent ID used for per-agent fairness cap. */
  agentId?: string;
  /** AbortSignal — rejects with AbortError if signalled while waiting. */
  signal?: AbortSignal;
  /** Max number of queued entries allowed for `agentId` at once. Default 2. */
  maxQueuedPerAgent?: number;
}

export interface LlmQueueStats {
  baseUrl: string;
  running: number;
  concurrency: number;
  queued: number;
  queueByPriority: { high: number; normal: number; low: number };
  /** agentId → number of queue entries for that agent */
  queueByAgent: Record<string, number>;
  /** Milliseconds the oldest waiting entry has been in the queue, or null if queue is empty. */
  oldestWaitMs: number | null;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface QueueEntry {
  resolve: () => void;
  reject: (err: Error) => void;
  priority: LlmPriority;
  agentId: string | undefined;
  /** Monotonically increasing for FIFO ordering within same priority. */
  seqno: number;
  /** Timestamp for wait-time tracking. */
  enqueuedAt: number;
}

interface SlotState {
  concurrency: number;
  running: number;
  queue: QueueEntry[];
}

let globalSeqno = 0;
const slots = new Map<string, SlotState>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeKey(baseUrl: string): string {
  return baseUrl.toLowerCase().replace(/\/$/, "");
}

function getSlot(baseUrl: string, concurrency: number): SlotState {
  const key = normalizeKey(baseUrl);
  let slot = slots.get(key);
  if (!slot) {
    slot = { concurrency, running: 0, queue: [] };
    slots.set(key, slot);
  }
  // Allow raising concurrency at runtime (e.g. config change) but never
  // lower it below what's currently running — that would deadlock.
  if (concurrency > slot.concurrency) {
    slot.concurrency = concurrency;
  }
  return slot;
}

/**
 * Insert `entry` into the sorted queue.
 * Ordering: priority DESC, seqno ASC (FIFO within same priority).
 * Binary search → O(log n) finds the insertion point, splice is O(n) but
 * queue depths in practice are single-digit so this is fine.
 */
function insertSorted(queue: QueueEntry[], entry: QueueEntry): void {
  let lo = 0;
  let hi = queue.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const m = queue[mid]!;
    // entry should go BEFORE m if: higher priority, or same priority and earlier seqno
    if (entry.priority > m.priority || (entry.priority === m.priority && entry.seqno < m.seqno)) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  queue.splice(lo, 0, entry);
}

function drainSlot(slot: SlotState): void {
  while (slot.running < slot.concurrency && slot.queue.length > 0) {
    const next = slot.queue.shift()!;
    slot.running++;
    next.resolve();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Thrown when an agent already has `maxQueuedPerAgent` entries waiting.
 * The caller should surface this as a throttle (back-pressure) rather than a hard failure.
 */
export class LlmQueueFullError extends Error {
  constructor(agentId: string, maxQueued: number) {
    super(
      `Agent ${agentId} already has ${maxQueued} run(s) waiting for an LLM slot — ` +
        `request dropped to prevent queue starvation`,
    );
    this.name = "LlmQueueFullError";
  }
}

/**
 * Acquire a slot for one Ollama inference call.
 * Returns a `release` function that MUST be called in a `finally` block.
 *
 * Throws `LlmQueueFullError` (synchronously) if the per-agent cap is exceeded.
 * Rejects with `AbortError` if `opts.signal` fires while waiting.
 */
export async function acquireLlmSlot(
  baseUrl: string,
  opts: LlmSlotOptions = {},
): Promise<() => void> {
  const { concurrency = 1, priority = 1, agentId, signal, maxQueuedPerAgent = 2 } = opts;
  const slot = getSlot(baseUrl, concurrency);

  // Fast-path: a slot is immediately available.
  if (slot.running < slot.concurrency) {
    slot.running++;
    return () => {
      slot.running--;
      drainSlot(slot);
    };
  }

  // Per-agent fairness cap — check before queuing.
  if (agentId && maxQueuedPerAgent > 0) {
    const alreadyWaiting = slot.queue.filter((e) => e.agentId === agentId).length;
    if (alreadyWaiting >= maxQueuedPerAgent) {
      throw new LlmQueueFullError(agentId, maxQueuedPerAgent);
    }
  }

  // Build the entry — resolve/reject are filled in below inside the Promise ctor.
  const entry: QueueEntry = {
    resolve: () => {},
    reject: () => {},
    priority: priority as LlmPriority,
    agentId,
    seqno: ++globalSeqno,
    enqueuedAt: Date.now(),
  };

  return new Promise<() => void>((resolve, reject) => {
    entry.resolve = () => {
      resolve(() => {
        slot.running--;
        drainSlot(slot);
      });
    };
    entry.reject = reject;

    insertSorted(slot.queue, entry);

    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          const idx = slot.queue.indexOf(entry);
          if (idx !== -1) slot.queue.splice(idx, 1);
          reject(signal.reason ?? new Error("Aborted while waiting for LLM slot"));
        },
        { once: true },
      );
    }
  });
}

/**
 * Full snapshot of queue state for a given Ollama base URL.
 * Safe to call at any time — returns zeroes if URL is not yet known.
 */
export function getLlmQueueStats(baseUrl: string): LlmQueueStats {
  const key = normalizeKey(baseUrl);
  const slot = slots.get(key);
  if (!slot) {
    return {
      baseUrl,
      running: 0,
      concurrency: 1,
      queued: 0,
      queueByPriority: { high: 0, normal: 0, low: 0 },
      queueByAgent: {},
      oldestWaitMs: null,
    };
  }

  let high = 0;
  let normal = 0;
  let low = 0;
  let oldestWaitMs: number | null = null;
  const queueByAgent: Record<string, number> = {};
  const now = Date.now();

  for (const e of slot.queue) {
    if (e.priority === 2) high++;
    else if (e.priority === 1) normal++;
    else low++;

    if (e.agentId) {
      queueByAgent[e.agentId] = (queueByAgent[e.agentId] ?? 0) + 1;
    }

    const waitMs = now - e.enqueuedAt;
    if (oldestWaitMs === null || waitMs > oldestWaitMs) {
      oldestWaitMs = waitMs;
    }
  }

  return {
    baseUrl,
    running: slot.running,
    concurrency: slot.concurrency,
    queued: slot.queue.length,
    queueByPriority: { high, normal, low },
    queueByAgent,
    oldestWaitMs,
  };
}

/**
 * Return all known base URLs (useful for stats aggregation across multiple endpoints).
 */
export function getLlmQueueBaseUrls(): string[] {
  return [...slots.keys()];
}

/** @deprecated Use getLlmQueueStats(baseUrl).queued instead. */
export function getLlmQueueDepth(baseUrl: string): number {
  return slots.get(normalizeKey(baseUrl))?.queue.length ?? 0;
}

/** @deprecated Use getLlmQueueStats(baseUrl).running instead. */
export function getLlmRunningCount(baseUrl: string): number {
  return slots.get(normalizeKey(baseUrl))?.running ?? 0;
}
