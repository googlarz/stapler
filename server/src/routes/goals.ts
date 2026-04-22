import { Router } from "express";
import { agents, goals, type Db } from "@stapler/db";
import { and, eq } from "drizzle-orm";
import { createGoalSchema, updateGoalSchema } from "@stapler/shared";
import { trackGoalCreated } from "@stapler/shared/telemetry";
import { validate } from "../middleware/validate.js";
import {
  goalService,
  goalVerificationService,
  heartbeatService,
  issueService,
  logActivity,
} from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { getTelemetryClient } from "../telemetry.js";
import { logger } from "../middleware/logger.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { decomposeGoal } from "../services/goal-decomposer.js";

export function goalRoutes(db: Db) {
  const router = Router();
  const svc = goalService(db);

  async function assertGoalUpdateReferences(
    goalId: string,
    companyId: string,
    body: { parentId?: string | null; ownerAgentId?: string | null },
  ) {
    if (body.parentId !== undefined && body.parentId !== null) {
      if (body.parentId === goalId) {
        throw badRequest("Goal cannot be its own parent");
      }

      const parent = await db
        .select({ id: goals.id, companyId: goals.companyId, parentId: goals.parentId })
        .from(goals)
        .where(eq(goals.id, body.parentId))
        .then((rows) => rows[0] ?? null);
      if (!parent || parent.companyId !== companyId) {
        throw badRequest("Parent goal must belong to the same company");
      }

      let currentParentId = parent.parentId;
      const visited = new Set<string>([goalId, parent.id]);
      while (currentParentId) {
        if (currentParentId === goalId) {
          throw conflict("Goal parent update would create a cycle");
        }
        if (visited.has(currentParentId)) break;
        visited.add(currentParentId);

        const next = await db
          .select({ id: goals.id, parentId: goals.parentId })
          .from(goals)
          .where(and(eq(goals.id, currentParentId), eq(goals.companyId, companyId)))
          .then((rows) => rows[0] ?? null);
        currentParentId = next?.parentId ?? null;
      }
    }

    if (body.ownerAgentId !== undefined && body.ownerAgentId !== null) {
      const owner = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, body.ownerAgentId), eq(agents.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!owner) {
        throw badRequest("Owner agent must belong to the same company");
      }
    }
  }

  router.get("/companies/:companyId/goals", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await svc.list(companyId);
    res.json(result);
  });

  router.get("/goals/:id", async (req, res) => {
    const id = req.params.id as string;
    const goal = await svc.getById(id);
    if (!goal) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }
    assertCompanyAccess(req, goal.companyId);
    const progress = await svc.getProgress(goal.companyId, goal.id);
    res.json({ ...goal, progress });
  });

  router.post("/companies/:companyId/goals", validate(createGoalSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const goal = await svc.create(companyId, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "goal.created",
      entityType: "goal",
      entityId: goal.id,
      details: { title: goal.title },
    });
    const telemetryClient = getTelemetryClient();
    if (telemetryClient) {
      trackGoalCreated(telemetryClient, { goalLevel: goal.level });
    }
    res.status(201).json(goal);
  });

  router.patch("/goals/:id", validate(updateGoalSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    await assertGoalUpdateReferences(id, existing.companyId, req.body);
    const goal = await svc.update(id, req.body);
    if (!goal) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: goal.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "goal.updated",
      entityType: "goal",
      entityId: goal.id,
      details: req.body,
    });

    res.json(goal);
  });

  router.post("/goals/:id/verify", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);

    const issueSvc = issueService(db);
    const verificationSvc = goalVerificationService(db, issueSvc, heartbeatService(db));
    const actor = getActorInfo(req);
    // The service writes its own goal.verification_requested audit row
    // with the full state transition context on the `created` path —
    // we pass the actor through so the entry is attributed to the
    // board user / agent that invoked the manual retrigger rather than
    // to the `system` stand-in used by the auto-fire hook path.
    const result = await verificationSvc.maybeCreateVerificationIssue(
      existing.companyId,
      existing.id,
      {
        manualTrigger: true,
        actor: {
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
        },
      },
    );

    if (result.kind === "skipped") {
      res.status(409).json({ error: "verification_skipped", reason: result.reason });
      return;
    }

    res.json({ verificationIssueId: result.verificationIssueId });
  });

  /**
   * Decompose a goal into concrete issues using an LLM.
   * POST /goals/:id/decompose
   * Body: { assigneeAgentId?: string, maxIssues?: number }
   */
  router.post("/goals/:id/decompose", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) throw notFound("Goal not found");
    assertCompanyAccess(req, existing.companyId);

    const assigneeAgentId =
      typeof req.body?.assigneeAgentId === "string" ? req.body.assigneeAgentId : null;
    const rawMax = Number(req.body?.maxIssues);
    const maxIssues = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 5;

    const result = await decomposeGoal(
      db,
      id,
      existing.companyId,
      assigneeAgentId,
      maxIssues,
    );

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "goal.decomposed",
      entityType: "goal",
      entityId: id,
      details: {
        issueCount: result.issues.length,
        issueIds: result.issues.map((i) => i.id),
      },
    });

    res.status(201).json(result);
  });

  router.delete("/goals/:id", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const goal = await svc.remove(id);
    if (!goal) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: goal.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "goal.deleted",
      entityType: "goal",
      entityId: goal.id,
    });

    res.json(goal);
  });

  return router;
}
