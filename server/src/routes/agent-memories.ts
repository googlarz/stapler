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
  getMemoryLimits,
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
 *
 * Route ordering note: specific literal segments (/wiki, /stats) are
 * registered BEFORE parameterised segments (/:id) so Express does not
 * shadow them.
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

  // ── List / search ────────────────────────────────────────────────────────

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

    // `excludeWiki=true` lets callers (e.g. MCP memorySearch tool) hide wiki
    // pages from results since those are already injected at run-start.
    const excludeWiki = req.query.excludeWiki === "true";

    if (q) {
      const results = await svc.search({ agentId, q, tags, limit, excludeWiki });
      res.json({ items: results, mode: "search" });
      return;
    }

    const items = await svc.list({ agentId, tags, limit, offset });
    res.json({ items, mode: "list" });
  });

  // ── Stats ────────────────────────────────────────────────────────────────

  /**
   * GET /agents/:agentId/memories/stats
   * Returns counts and byte totals split by episodic vs wiki, plus the
   * configured limits so UI and agents can self-monitor.
   */
  router.get("/agents/:agentId/memories/stats", async (req, res) => {
    const agentId = req.params.agentId as string;
    const agent = await loadAgentOrNull(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    assertCompanyAccess(req, agent.companyId);
    assertAgentIdentity(req, agentId);

    const memStats = await svc.stats(agentId);
    const limits = getMemoryLimits();
    res.json({ ...memStats, limits });
  });

  // ── Cross-agent peer search ─────────────────────────────────────────────
  // Allows any agent (or board user) in the same company to search ANOTHER
  // agent's episodic memories. Used for knowledge sharing between agents
  // (e.g. the Bavaria agent reading Berlin agent episodic notes).
  //
  // Auth difference from the regular list/search route: `assertAgentIdentity`
  // is deliberately absent — any same-company caller may read. The company
  // boundary is still enforced by `assertCompanyAccess`.
  //
  // MUST be registered before /:id so "peer-search" is not treated as a UUID.

  router.get("/agents/:agentId/memories/peer-search", async (req, res) => {
    const agentId = req.params.agentId as string;
    const agent = await loadAgentOrNull(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    assertCompanyAccess(req, agent.companyId);
    // No assertAgentIdentity — cross-agent reads are the whole point.

    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) {
      res.status(400).json({ error: "q is required" });
      return;
    }
    const rawLimit = req.query.limit;
    const limit = rawLimit ? Math.max(1, Math.min(Number.parseInt(String(rawLimit), 10) || 10, 50)) : 10;
    const rawTags = typeof req.query.tags === "string" ? req.query.tags : "";
    const tags = rawTags ? rawTags.split(",").map((t) => t.trim()).filter(Boolean) : undefined;

    const results = await svc.search({ agentId, q, tags, limit, excludeWiki: false });
    res.json({ items: results, mode: "peer-search", targetAgentId: agentId });
  });

  // ── Wiki pages ───────────────────────────────────────────────────────────
  // All /wiki routes MUST appear before /:id so Express does not shadow them.

  router.put("/agents/:agentId/memories/wiki/:slug", async (req, res) => {
    const agentId = req.params.agentId as string;
    const slug = req.params.slug as string;
    const agent = await loadAgentOrNull(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    assertCompanyAccess(req, agent.companyId);
    assertAgentIdentity(req, agentId);

    const { content, tags } = req.body as { content?: unknown; tags?: unknown };
    if (typeof content !== "string" || content.trim().length === 0) {
      res.status(400).json({ error: "content must be a non-empty string" });
      return;
    }

    const actor = getActorInfo(req);
    try {
      const memory = await svc.wikiUpsert({
        companyId: agent.companyId,
        agentId,
        wikiSlug: slug,
        content,
        tags: Array.isArray(tags)
          ? tags.filter((t): t is string => typeof t === "string")
          : undefined,
        runId: actor.runId,
      });

      await logActivity(db, {
        companyId: agent.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? agentId,
        runId: actor.runId,
        action: "memory.wiki_upserted",
        entityType: "agent_memory",
        entityId: memory.id,
        details: { wikiSlug: memory.wikiSlug, contentBytes: memory.contentBytes },
      });

      res.json(memory);
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
  });

  router.get("/agents/:agentId/memories/wiki", async (req, res) => {
    const agentId = req.params.agentId as string;
    const agent = await loadAgentOrNull(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    assertCompanyAccess(req, agent.companyId);
    assertAgentIdentity(req, agentId);

    const items = await svc.wikiList(agentId);
    res.json({ items });
  });

  router.get("/agents/:agentId/memories/wiki/:slug", async (req, res) => {
    const agentId = req.params.agentId as string;
    const slug = req.params.slug as string;
    const agent = await loadAgentOrNull(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    assertCompanyAccess(req, agent.companyId);
    assertAgentIdentity(req, agentId);

    const memory = await svc.wikiGet(agentId, slug);
    if (!memory) {
      res.status(404).json({ error: "Wiki page not found" });
      return;
    }
    res.json(memory);
  });

  router.delete("/agents/:agentId/memories/wiki/:slug", async (req, res) => {
    const agentId = req.params.agentId as string;
    const slug = req.params.slug as string;
    const agent = await loadAgentOrNull(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    assertCompanyAccess(req, agent.companyId);
    assertAgentIdentity(req, agentId);

    const removed = await svc.wikiRemove(agentId, slug);
    if (!removed) {
      res.status(404).json({ error: "Wiki page not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: agent.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? agentId,
      runId: actor.runId,
      action: "memory.wiki_deleted",
      entityType: "agent_memory",
      entityId: removed.id,
      details: { wikiSlug: removed.wikiSlug },
    });

    res.json(removed);
  });

  // ── Episodic memories by id ──────────────────────────────────────────────
  // Registered AFTER /wiki/* so the literal "wiki" segment is not treated
  // as a memory id.

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
          expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt as string) : undefined,
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

    // Single scoped DELETE — the service filters by (id, agentId), so
    // we don't need a separate ownership pre-check. A concurrent delete
    // from another request just returns null here and we 404.
    const removed = await svc.remove(id, agentId);
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
