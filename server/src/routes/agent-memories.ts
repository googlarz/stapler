import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createAgentMemorySchema,
  listAgentMemoriesQuerySchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import {
  agentMemoryService,
  agentService,
  logActivity,
  MemoryContentTooLargeError,
} from "../services/index.js";
import { assertAgentIdentity, assertCompanyAccess, getActorInfo } from "./authz.js";

/**
 * Agent memory routes. All routes are scoped to `/agents/:agentId/memories`
 * and enforce three authorization layers:
 *
 *   1. `assertCompanyAccess` — gates board users to the agent's company
 *      (agent keys are already bound to a company in the auth middleware).
 *   2. `assertAgentIdentity` — if the caller is an agent key, require
 *      `req.actor.agentId === agentId`. This closes the
 *      `paperclipApiRequest` raw-URL escape hatch: even if an agent
 *      constructs `/agents/OTHER/memories`, the token resolves to its
 *      own agentId so the guard rejects the call.
 *   3. Route validators on body/query via zod.
 */
export function agentMemoryRoutes(db: Db) {
  const router = Router();
  const svc = agentMemoryService(db);
  const agents = agentService(db);

  async function loadAgentOrNull(agentId: string) {
    try {
      return await agents.getById(agentId);
    } catch {
      return null;
    }
  }

  router.get("/agents/:agentId/memories", async (req, res) => {
    const agentId = req.params.agentId as string;
    const agent = await loadAgentOrNull(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    assertCompanyAccess(req, agent.companyId);
    assertAgentIdentity(req, agentId);

    const parsed = listAgentMemoriesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
      return;
    }
    const { q, tags, limit, offset } = parsed.data;

    if (q) {
      const results = await svc.search({ agentId, q, tags, limit });
      res.json({ items: results, mode: "search" });
      return;
    }

    const items = await svc.list({ agentId, tags, limit, offset });
    res.json({ items, mode: "list" });
  });

  router.get("/agents/:agentId/memories/:id", async (req, res) => {
    const agentId = req.params.agentId as string;
    const id = req.params.id as string;
    const agent = await loadAgentOrNull(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    assertCompanyAccess(req, agent.companyId);
    assertAgentIdentity(req, agentId);

    const memory = await svc.getById(id);
    if (!memory || memory.agentId !== agentId) {
      res.status(404).json({ error: "Memory not found" });
      return;
    }
    res.json(memory);
  });

  router.post(
    "/agents/:agentId/memories",
    validate(createAgentMemorySchema),
    async (req, res) => {
      const agentId = req.params.agentId as string;
      const agent = await loadAgentOrNull(agentId);
      if (!agent) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      assertCompanyAccess(req, agent.companyId);
      assertAgentIdentity(req, agentId);

      const actor = getActorInfo(req);

      try {
        const result = await svc.save({
          companyId: agent.companyId,
          agentId,
          content: req.body.content,
          tags: req.body.tags,
          runId: actor.runId,
        });

        // Only log on genuine inserts — dedupes are idempotent and
        // should not flood the activity log.
        if (!result.deduped) {
          await logActivity(db, {
            companyId: agent.companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId ?? agentId,
            runId: actor.runId,
            action: "memory.saved",
            entityType: "agent_memory",
            entityId: result.memory.id,
            details: {
              tags: result.memory.tags,
              contentBytes: result.memory.contentBytes,
            },
          });
        }

        res.status(result.deduped ? 200 : 201).json(result);
      } catch (err) {
        if (err instanceof MemoryContentTooLargeError) {
          res.status(413).json({
            error: "Memory content too large",
            contentBytes: err.contentBytes,
            maxContentBytes: err.maxContentBytes,
          });
          return;
        }
        throw err;
      }
    },
  );

  router.delete("/agents/:agentId/memories/:id", async (req, res) => {
    const agentId = req.params.agentId as string;
    const id = req.params.id as string;
    const agent = await loadAgentOrNull(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    assertCompanyAccess(req, agent.companyId);
    assertAgentIdentity(req, agentId);

    const existing = await svc.getById(id);
    if (!existing || existing.agentId !== agentId) {
      res.status(404).json({ error: "Memory not found" });
      return;
    }
    const removed = await svc.remove(id);
    if (!removed) {
      res.status(404).json({ error: "Memory not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: agent.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? agentId,
      runId: actor.runId,
      action: "memory.deleted",
      entityType: "agent_memory",
      entityId: removed.id,
      details: { tags: removed.tags },
    });

    res.json(removed);
  });

  return router;
}
