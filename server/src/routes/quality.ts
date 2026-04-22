/**
 * Quality routes — exposes continuous-scoring data for the Quality Flywheel.
 *
 * Pillar 1 only: per-run scores and per-agent rolling averages.
 * Future pillars extend these routes with failure-mode clustering,
 * drift alerts, and quality trends aggregation.
 */

import { Router } from "express";
import { and, avg, count, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@stapler/db";
import { agents, heartbeatRuns, runScores } from "@stapler/db";
import { assertCompanyAccess } from "./authz.js";
import { notFound } from "../errors.js";

const WINDOW_DAYS = 30;

export function qualityRoutes(db: Db) {
  const router = Router();

  /** Get the latest score for a heartbeat run (404 if not judged yet). */
  router.get("/runs/:id/score", async (req, res) => {
    const { id } = req.params as { id: string };
    const rows = await db
      .select()
      .from(runScores)
      .where(eq(runScores.runId, id))
      .orderBy(desc(runScores.judgedAt))
      .limit(1);
    const row = rows[0];
    if (!row) throw notFound("No score for this run");
    assertCompanyAccess(req, row.companyId);
    res.json(row);
  });

  /**
   * Rolling quality trend for an agent:
   *   { avgScore, sampleSize, recent: [{ runId, score, judgedAt, reasoning }] }
   * Window defaults to 30 days. `?limit=N` caps the recent list (default 20).
   */
  router.get("/agents/:id/quality/trend", async (req, res) => {
    const { id: agentId } = req.params as { id: string };
    const agentRows = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    const agent = agentRows[0];
    if (!agent) throw notFound("Agent not found");
    assertCompanyAccess(req, agent.companyId);

    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const summaryRows = await db
      .select({
        avgScore: avg(runScores.score).mapWith(Number),
        sampleSize: count(runScores.id).mapWith(Number),
      })
      .from(runScores)
      .where(and(eq(runScores.agentId, agentId), gte(runScores.judgedAt, since)));
    const summary = summaryRows[0] ?? { avgScore: null, sampleSize: 0 };

    const recent = await db
      .select({
        id: runScores.id,
        runId: runScores.runId,
        score: runScores.score,
        reasoning: runScores.reasoning,
        judgedAt: runScores.judgedAt,
        rubricSource: runScores.rubricSource,
        judgeModel: runScores.judgeModel,
      })
      .from(runScores)
      .where(eq(runScores.agentId, agentId))
      .orderBy(desc(runScores.judgedAt))
      .limit(limit);

    res.json({
      windowDays: WINDOW_DAYS,
      avgScore: summary.avgScore,
      sampleSize: summary.sampleSize,
      recent,
    });
  });

  /**
   * Company-wide quality summary: per-agent rolling avg + sample size over
   * the default window. Used by the Quality dashboard (future Pillar 5).
   */
  router.get("/companies/:companyId/quality/trend", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        agentId: runScores.agentId,
        avgScore: avg(runScores.score).mapWith(Number),
        sampleSize: count(runScores.id).mapWith(Number),
        lastJudgedAt: sql<Date>`max(${runScores.judgedAt})`,
      })
      .from(runScores)
      .where(and(eq(runScores.companyId, companyId), gte(runScores.judgedAt, since)))
      .groupBy(runScores.agentId);

    res.json({ windowDays: WINDOW_DAYS, items: rows });
  });

  /** List recent scores across a company (for timelines + drill-down). */
  router.get("/companies/:companyId/quality/recent", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const rows = await db
      .select({
        id: runScores.id,
        runId: runScores.runId,
        agentId: runScores.agentId,
        score: runScores.score,
        reasoning: runScores.reasoning,
        judgedAt: runScores.judgedAt,
        judgeModel: runScores.judgeModel,
        runStatus: heartbeatRuns.status,
        runStartedAt: heartbeatRuns.startedAt,
      })
      .from(runScores)
      .innerJoin(heartbeatRuns, eq(heartbeatRuns.id, runScores.runId))
      .where(eq(runScores.companyId, companyId))
      .orderBy(desc(runScores.judgedAt))
      .limit(limit);

    res.json({ items: rows });
  });

  return router;
}
