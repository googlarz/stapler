import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import type { Db } from "@stapler/db";
import { evalCaseResults, evalCases, evalRuns, evalSuites } from "@stapler/db";
import { createEvalCaseSchema, createEvalSuiteSchema, updateEvalSuiteSchema, triggerEvalRunSchema } from "@stapler/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { notFound } from "../errors.js";
import { runEvalSuite } from "../services/eval-runner.js";

export function evalRoutes(db: Db) {
  const router = Router();

  // ── Suites ───────────────────────────────────────────────────────────────

  /** List eval suites for a company */
  router.get("/companies/:companyId/eval-suites", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);

    const suites = await db
      .select()
      .from(evalSuites)
      .where(eq(evalSuites.companyId, companyId))
      .orderBy(desc(evalSuites.createdAt));

    res.json({ items: suites });
  });

  /** Create an eval suite */
  router.post(
    "/companies/:companyId/eval-suites",
    validate(createEvalSuiteSchema),
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);

      const { agentId, name, description, scheduleExpression, alertThreshold } = req.body as {
        agentId: string;
        name: string;
        description?: string;
        scheduleExpression?: string;
        alertThreshold?: number;
      };

      const [suite] = await db
        .insert(evalSuites)
        .values({
          companyId,
          agentId,
          name,
          description: description ?? null,
          scheduleExpression: scheduleExpression ?? null,
          alertThreshold: alertThreshold ?? null,
        })
        .returning();

      res.status(201).json(suite);
    },
  );

  /** Get a single eval suite with its cases */
  router.get("/eval-suites/:id", async (req, res) => {
    const { id } = req.params as { id: string };
    const rows = await db.select().from(evalSuites).where(eq(evalSuites.id, id)).limit(1);
    const suite = rows[0];
    if (!suite) throw notFound("Eval suite not found");
    assertCompanyAccess(req, suite.companyId);

    const cases = await db
      .select()
      .from(evalCases)
      .where(eq(evalCases.suiteId, id))
      .orderBy(evalCases.createdAt);

    res.json({ ...suite, cases });
  });

  /** Update an eval suite (name, description, schedule, threshold) */
  router.patch(
    "/eval-suites/:id",
    validate(updateEvalSuiteSchema),
    async (req, res) => {
      const { id } = req.params as { id: string };
      const rows = await db.select().from(evalSuites).where(eq(evalSuites.id, id)).limit(1);
      const suite = rows[0];
      if (!suite) throw notFound("Eval suite not found");
      assertCompanyAccess(req, suite.companyId);

      const body = req.body as {
        name?: string;
        description?: string | null;
        scheduleExpression?: string | null;
        alertThreshold?: number | null;
      };

      const [updated] = await db
        .update(evalSuites)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.scheduleExpression !== undefined ? { scheduleExpression: body.scheduleExpression } : {}),
          ...(body.alertThreshold !== undefined ? { alertThreshold: body.alertThreshold } : {}),
          updatedAt: new Date(),
        })
        .where(eq(evalSuites.id, id))
        .returning();

      res.json(updated);
    },
  );

  /** Delete an eval suite */
  router.delete("/eval-suites/:id", async (req, res) => {
    const { id } = req.params as { id: string };
    const rows = await db.select().from(evalSuites).where(eq(evalSuites.id, id)).limit(1);
    const suite = rows[0];
    if (!suite) throw notFound("Eval suite not found");
    assertCompanyAccess(req, suite.companyId);

    await db.delete(evalSuites).where(eq(evalSuites.id, id));
    res.status(204).send();
  });

  // ── Cases ─────────────────────────────────────────────────────────────────

  /** Add a test case to a suite */
  router.post(
    "/eval-suites/:id/cases",
    validate(createEvalCaseSchema),
    async (req, res) => {
      const { id: suiteId } = req.params as { id: string };
      const rows = await db.select().from(evalSuites).where(eq(evalSuites.id, suiteId)).limit(1);
      const suite = rows[0];
      if (!suite) throw notFound("Eval suite not found");
      assertCompanyAccess(req, suite.companyId);

      const { name, inputJson, criteria, expectedTags } = req.body as {
        name: string;
        inputJson: Record<string, unknown>;
        criteria: string;
        expectedTags: string[];
      };

      const [evalCase] = await db
        .insert(evalCases)
        .values({ suiteId, name, inputJson, criteria, expectedTags })
        .returning();

      res.status(201).json(evalCase);
    },
  );

  /** Delete a test case */
  router.delete("/eval-suites/:suiteId/cases/:caseId", async (req, res) => {
    const { suiteId, caseId } = req.params as { suiteId: string; caseId: string };
    const rows = await db.select().from(evalSuites).where(eq(evalSuites.id, suiteId)).limit(1);
    const suite = rows[0];
    if (!suite) throw notFound("Eval suite not found");
    assertCompanyAccess(req, suite.companyId);

    await db.delete(evalCases).where(eq(evalCases.id, caseId));
    res.status(204).send();
  });

  // ── Runs ──────────────────────────────────────────────────────────────────

  /** Trigger an eval run for a suite (async — returns run ID immediately) */
  router.post(
    "/eval-suites/:id/run",
    validate(triggerEvalRunSchema),
    async (req, res) => {
      const { id: suiteId } = req.params as { id: string };
      const rows = await db.select().from(evalSuites).where(eq(evalSuites.id, suiteId)).limit(1);
      const suite = rows[0];
      if (!suite) throw notFound("Eval suite not found");
      assertCompanyAccess(req, suite.companyId);

      const triggeredBy =
        (req.body as { triggeredBy?: string }).triggeredBy ??
        (req.actor.type === "board" ? (req.actor.userId ?? "board") : req.actor.type);

      const [run] = await db
        .insert(evalRuns)
        .values({ suiteId, triggeredBy: String(triggeredBy) })
        .returning();

      // Fire-and-forget — run executes asynchronously
      void runEvalSuite(db, run!.id).catch((err: unknown) => {
        console.error(`[evals] runEvalSuite ${run!.id} failed:`, err);
      });

      res.status(202).json(run);
    },
  );

  /** Get an eval run with its case results */
  router.get("/eval-runs/:id", async (req, res) => {
    const { id } = req.params as { id: string };
    const runRows = await db.select().from(evalRuns).where(eq(evalRuns.id, id)).limit(1);
    const run = runRows[0];
    if (!run) throw notFound("Eval run not found");

    // Verify company access via suite
    const suiteRows = await db
      .select()
      .from(evalSuites)
      .where(eq(evalSuites.id, run.suiteId))
      .limit(1);
    const suite = suiteRows[0];
    if (!suite) throw notFound("Eval suite not found");
    assertCompanyAccess(req, suite.companyId);

    const results = await db
      .select()
      .from(evalCaseResults)
      .where(eq(evalCaseResults.runId, id))
      .orderBy(evalCaseResults.createdAt);

    res.json({ ...run, results });
  });

  /** List eval runs for a company (across all suites) */
  router.get("/companies/:companyId/eval-runs", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);

    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const runs = await db
      .select({
        id: evalRuns.id,
        suiteId: evalRuns.suiteId,
        triggeredBy: evalRuns.triggeredBy,
        status: evalRuns.status,
        startedAt: evalRuns.startedAt,
        finishedAt: evalRuns.finishedAt,
        summaryJson: evalRuns.summaryJson,
        createdAt: evalRuns.createdAt,
        suiteName: evalSuites.name,
        agentId: evalSuites.agentId,
      })
      .from(evalRuns)
      .innerJoin(evalSuites, eq(evalRuns.suiteId, evalSuites.id))
      .where(eq(evalSuites.companyId, companyId))
      .orderBy(desc(evalRuns.createdAt))
      .limit(limit);

    res.json({ items: runs });
  });

  return router;
}
