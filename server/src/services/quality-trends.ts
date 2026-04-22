/**
 * Quality trends service — Pillar 5 of the Quality Flywheel.
 *
 * Aggregates run_scores into rolling windows (7d/30d/90d) per agent.
 * Detects quality drift: if the 7-day rolling average drops more than
 * driftThreshold (default 10%) compared to the previous 7-day window,
 * logs a `quality.drift` activity entry.
 *
 * Called from run-scorer after each score is written so the dashboard
 * always reflects the latest state.
 */

import { and, avg, count, eq, gte, lt } from "drizzle-orm";
import type { Db } from "@stapler/db";
import { agents, runScores } from "@stapler/db";
import { logActivity } from "./activity-log.js";

const DEFAULT_DRIFT_THRESHOLD = 0.1; // 10% drop triggers an alert

export interface QualityWindow {
  windowDays: number;
  avgScore: number | null;
  sampleSize: number;
}

export interface AgentQualityTrends {
  agentId: string;
  companyId: string;
  windows: {
    d7: QualityWindow;
    d30: QualityWindow;
    d90: QualityWindow;
  };
}

async function getWindowAvg(
  db: Db,
  agentId: string,
  sinceMs: number,
  untilMs?: number,
): Promise<{ avgScore: number | null; sampleSize: number }> {
  const since = new Date(sinceMs);
  const where = untilMs
    ? and(eq(runScores.agentId, agentId), gte(runScores.judgedAt, since), lt(runScores.judgedAt, new Date(untilMs)))
    : and(eq(runScores.agentId, agentId), gte(runScores.judgedAt, since));

  const rows = await db
    .select({
      avgScore: avg(runScores.score).mapWith(Number),
      sampleSize: count(runScores.id).mapWith(Number),
    })
    .from(runScores)
    .where(where);
  const row = rows[0];
  return { avgScore: row?.avgScore ?? null, sampleSize: row?.sampleSize ?? 0 };
}

export async function getAgentQualityTrends(
  db: Db,
  agentId: string,
  companyId: string,
): Promise<AgentQualityTrends> {
  const now = Date.now();
  const [d7, d30, d90] = await Promise.all([
    getWindowAvg(db, agentId, now - 7 * 86400_000),
    getWindowAvg(db, agentId, now - 30 * 86400_000),
    getWindowAvg(db, agentId, now - 90 * 86400_000),
  ]);
  return {
    agentId,
    companyId,
    windows: {
      d7: { windowDays: 7, ...d7 },
      d30: { windowDays: 30, ...d30 },
      d90: { windowDays: 90, ...d90 },
    },
  };
}

/**
 * Check for quality drift after a new score is written.
 * Compares the current 7-day rolling avg to the previous 7-day window.
 * Fires a `quality.drift` activity log when drift is detected.
 *
 * Called from run-scorer — fire-and-forget.
 */
export async function checkDrift(
  db: Db,
  agentId: string,
  companyId: string,
): Promise<void> {
  const now = Date.now();

  // Current 7-day window
  const current = await getWindowAvg(db, agentId, now - 7 * 86400_000);
  if (current.avgScore == null || current.sampleSize < 3) return; // not enough data

  // Previous 7-day window (7–14 days ago)
  const previous = await getWindowAvg(
    db,
    agentId,
    now - 14 * 86400_000,
    now - 7 * 86400_000,
  );
  if (previous.avgScore == null || previous.sampleSize < 3) return;

  const agentRows = await db
    .select({ companyId: agents.companyId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  const agent = agentRows[0];
  if (!agent) return;

  const drop = previous.avgScore - current.avgScore;
  const driftThreshold =
    typeof process.env.STAPLER_DRIFT_THRESHOLD === "string"
      ? parseFloat(process.env.STAPLER_DRIFT_THRESHOLD) || DEFAULT_DRIFT_THRESHOLD
      : DEFAULT_DRIFT_THRESHOLD;

  if (drop > driftThreshold) {
    await logActivity(db, {
      companyId,
      actorType: "system",
      actorId: "quality-trends",
      action: "quality.drift",
      entityType: "agent",
      entityId: agentId,
      details: {
        currentAvg: Math.round(current.avgScore * 100) / 100,
        previousAvg: Math.round(previous.avgScore * 100) / 100,
        drop: Math.round(drop * 100) / 100,
        driftThreshold,
        currentSampleSize: current.sampleSize,
        previousSampleSize: previous.sampleSize,
        message: `Quality drift detected: 7-day avg dropped ${Math.round(drop * 100)}% (from ${Math.round(previous.avgScore * 100)}% to ${Math.round(current.avgScore * 100)}%)`,
      },
    }).catch(() => {});
  }
}
