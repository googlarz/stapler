/**
 * Collaboration analyzer — Pillar 7 of the Meta-Flywheel.
 *
 * Instruments agent-to-agent delegation:
 *  - recordDelegationEdge(): called when an agent creates an issue and
 *    assigns it to another agent (delegation detection in issue create route)
 *  - finalizeDelegationEdge(): called when the delegated issue resolves
 *  - detectAntiPatterns(): runs anti-pattern checks (ping-pong, depth runaway)
 *    on the current delegation chain
 *
 * Per-pair stats (win rates, avg round-trip) are computed on-the-fly from
 * the delegation_edges table and surfaced via getAgentCollabStats().
 *
 * Anti-patterns:
 *   Ping-pong: A→B followed by B→A within the same issue chain (no progress)
 *   Depth runaway: delegation chain depth > MAX_DEPTH (4)
 */

import { and, avg, count, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@stapler/db";
import { agents, delegationEdges } from "@stapler/db";
import { logActivity } from "./activity-log.js";

const MAX_DEPTH = 4;
const PING_PONG_WINDOW_HOURS = 2; // B→A within 2h of A→B = ping-pong

export interface CollabPairStats {
  fromAgentId: string;
  toAgentId: string;
  toAgentName: string;
  totalDelegations: number;
  successCount: number;
  winRate: number;
  avgRoundTripMs: number | null;
}

/**
 * Record a new delegation edge when an agent assigns an issue to another agent.
 * Detects depth by looking at the parent issue's existing delegation chain.
 * Returns the edge id or null on error.
 */
export async function recordDelegationEdge(
  db: Db,
  companyId: string,
  fromAgentId: string,
  toAgentId: string,
  issueId: string,
): Promise<string | null> {
  try {
    // Compute depth: find the most recent pending edge to fromAgent for the same company
    // (simple heuristic: count edges where toAgent = fromAgent that are still unresolved)
    const pendingEdgesToFrom = await db
      .select({ id: delegationEdges.id })
      .from(delegationEdges)
      .where(
        and(
          eq(delegationEdges.companyId, companyId),
          eq(delegationEdges.toAgentId, fromAgentId),
          isNull(delegationEdges.resolvedAt),
        ),
      )
      .limit(10);
    const depth = pendingEdgesToFrom.length;

    const depthRunaway = depth >= MAX_DEPTH;

    const [edge] = await db
      .insert(delegationEdges)
      .values({
        companyId,
        fromAgentId,
        toAgentId,
        issueId,
        depth,
        depthRunawayDetected: depthRunaway,
      })
      .returning({ id: delegationEdges.id });

    if (depthRunaway) {
      void logActivity(db, {
        companyId,
        actorType: "system",
        actorId: "collaboration-analyzer",
        action: "collab.depth_runaway",
        entityType: "issue",
        entityId: issueId,
        details: {
          fromAgentId,
          toAgentId,
          depth,
          message: `Delegation chain depth ${depth} exceeds max ${MAX_DEPTH}. Consider escalating to a goal owner.`,
        },
      }).catch(() => {});
    }

    // Check for ping-pong: has toAgent recently delegated back to fromAgent?
    const windowMs = PING_PONG_WINDOW_HOURS * 60 * 60 * 1000;
    const windowStart = new Date(Date.now() - windowMs);
    const pingPongEdges = await db
      .select({ id: delegationEdges.id })
      .from(delegationEdges)
      .where(
        and(
          eq(delegationEdges.companyId, companyId),
          eq(delegationEdges.fromAgentId, toAgentId),
          eq(delegationEdges.toAgentId, fromAgentId),
          isNull(delegationEdges.outcome), // still unresolved
        ),
      )
      .limit(1);

    if (pingPongEdges.length > 0) {
      // Mark this edge as ping-pong
      await db
        .update(delegationEdges)
        .set({ pingPongDetected: true })
        .where(eq(delegationEdges.id, edge.id));

      void logActivity(db, {
        companyId,
        actorType: "system",
        actorId: "collaboration-analyzer",
        action: "collab.ping_pong",
        entityType: "issue",
        entityId: issueId,
        details: {
          fromAgentId,
          toAgentId,
          windowHours: PING_PONG_WINDOW_HOURS,
          message: `Ping-pong detected: ${fromAgentId} and ${toAgentId} are delegating back and forth without progress.`,
        },
      }).catch(() => {});
    }

    return edge.id;
  } catch {
    return null;
  }
}

/**
 * Finalize a delegation edge when the delegated issue resolves.
 * Called from the heartbeat finalize path via the issue's routing outcome.
 */
export async function finalizeDelegationEdge(
  db: Db,
  issueId: string,
  outcome: "succeeded" | "failed" | "stalled" | "cancelled",
): Promise<void> {
  try {
    const edges = await db
      .select({ id: delegationEdges.id, createdAt: delegationEdges.createdAt })
      .from(delegationEdges)
      .where(
        and(
          eq(delegationEdges.issueId, issueId),
          isNull(delegationEdges.resolvedAt),
        ),
      );

    for (const edge of edges) {
      const roundTripMs = Date.now() - edge.createdAt.getTime();
      await db
        .update(delegationEdges)
        .set({
          outcome,
          resolvedAt: new Date(),
          roundTripMs,
        })
        .where(eq(delegationEdges.id, edge.id));
    }
  } catch {
    // Non-critical
  }
}

/**
 * Get per-pair collaboration stats for an agent (as the delegator).
 * Returns the top 10 agents this agent delegates to, sorted by total delegations.
 */
export async function getAgentCollabStats(
  db: Db,
  fromAgentId: string,
  companyId: string,
): Promise<CollabPairStats[]> {
  // Aggregate by toAgent
  const rows = await db
    .select({
      toAgentId: delegationEdges.toAgentId,
      totalDelegations: count(delegationEdges.id).mapWith(Number),
      avgRoundTripMs: avg(delegationEdges.roundTripMs).mapWith(Number),
    })
    .from(delegationEdges)
    .where(
      and(
        eq(delegationEdges.fromAgentId, fromAgentId),
        eq(delegationEdges.companyId, companyId),
      ),
    )
    .groupBy(delegationEdges.toAgentId)
    .orderBy(desc(count(delegationEdges.id)))
    .limit(10);

  const results: CollabPairStats[] = [];
  for (const row of rows) {
    // Count successes
    const successRows = await db
      .select({ n: count(delegationEdges.id).mapWith(Number) })
      .from(delegationEdges)
      .where(
        and(
          eq(delegationEdges.fromAgentId, fromAgentId),
          eq(delegationEdges.toAgentId, row.toAgentId),
          eq(delegationEdges.companyId, companyId),
          eq(delegationEdges.outcome, "succeeded"),
        ),
      );
    const successCount = successRows[0]?.n ?? 0;

    const agentRow = await db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.id, row.toAgentId))
      .limit(1);

    results.push({
      fromAgentId,
      toAgentId: row.toAgentId,
      toAgentName: agentRow[0]?.name ?? row.toAgentId.slice(0, 8),
      totalDelegations: row.totalDelegations,
      successCount,
      winRate: row.totalDelegations > 0 ? successCount / row.totalDelegations : 0,
      avgRoundTripMs: row.avgRoundTripMs ?? null,
    });
  }
  return results;
}
