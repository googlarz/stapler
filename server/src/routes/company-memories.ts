import { Router } from "express";
import type { Db } from "@stapler/db";
import { companyMemoryService, logActivity, MemoryContentTooLargeError } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

/**
 * Company memory routes. All routes are scoped to `/companies/:companyId/memories`
 * and enforce company-level authorization — any agent or board user with access
 * to the company may read and write shared memories.
 *
 * Route ordering: specific literal segments (/wiki, /search, /stats) come before
 * parameterised segments (/:id) so Express does not shadow them.
 */
export function companyMemoryRoutes(db: Db) {
  const router = Router();
  const svc = companyMemoryService(db);

  // ── List / search ─────────────────────────────────────────────────────────
  // When `q` is present, dispatches to the similarity search path and returns
  // `{items, mode: "search"}`. Otherwise returns `{items, mode: "list"}`.

  router.get("/companies/:companyId/memories", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const rawTags = req.query.tags as string | undefined;
    const rawLimit = req.query.limit as string | undefined;
    const rawOffset = req.query.offset as string | undefined;
    const q = (req.query.q as string | undefined)?.trim();

    let tags: string[] | undefined;
    if (rawTags !== undefined) {
      tags = rawTags.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
    }

    let limit = 50;
    if (rawLimit !== undefined) {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
        res.status(400).json({ error: "Invalid query" });
        return;
      }
      limit = parsed;
    }

    // Dispatch to similarity search when a keyword query is supplied.
    if (q) {
      const items = await svc.search({ companyId, q, tags, limit: Math.min(limit, 100) });
      res.json({ items, mode: "search" });
      return;
    }

    let offset = 0;
    if (rawOffset !== undefined) {
      const parsed = Number(rawOffset);
      if (!Number.isInteger(parsed) || parsed < 0) {
        res.status(400).json({ error: "Invalid query" });
        return;
      }
      offset = parsed;
    }

    const items = await svc.list({ companyId, tags, limit, offset });
    res.json({ items, mode: "list" });
  });

  // ── Stats ─────────────────────────────────────────────────────────────────

  router.get("/companies/:companyId/memories/stats", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const stats = await svc.stats(companyId);
    res.json(stats);
  });

  // ── Search (dedicated endpoint — kept for backwards compat) ───────────────

  router.get("/companies/:companyId/memories/search", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const q = (req.query.q as string | undefined)?.trim();
    if (!q) {
      res.status(400).json({ error: "q is required" });
      return;
    }

    const rawLimit = req.query.limit as string | undefined;
    let limit = 10;
    if (rawLimit !== undefined) {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        res.status(400).json({ error: "Invalid query" });
        return;
      }
      limit = parsed;
    }

    const rawTags = req.query.tags as string | undefined;
    const tags = rawTags
      ? rawTags.split(",").map((t) => t.trim()).filter((t) => t.length > 0)
      : undefined;

    const items = await svc.search({ companyId, q, tags, limit });
    res.json({ items, mode: "search" });
  });

  // ── Wiki pages ───────────────────────────────────────────────────────────
  // All /wiki routes MUST appear before /:id.

  /**
   * Normalize a slug the same way the service does, so URL-encoded or
   * mixed-case slugs resolve to the same stored key.
   */
  function normalizeSlug(raw: string): string {
    return raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 64);
  }

  router.put("/companies/:companyId/memories/wiki/:slug", async (req, res) => {
    const companyId = req.params.companyId as string;
    const slug = normalizeSlug(req.params.slug as string);
    if (!slug) {
      res.status(400).json({ error: "Invalid slug" });
      return;
    }
    assertCompanyAccess(req, companyId);

    const { content, tags } = req.body as { content?: unknown; tags?: unknown };
    if (typeof content !== "string" || content.trim().length === 0) {
      res.status(400).json({ error: "content must be a non-empty string" });
      return;
    }

    const actor = getActorInfo(req);
    try {
      const memory = await svc.wikiUpsert({
        companyId,
        wikiSlug: slug,
        content,
        tags: Array.isArray(tags)
          ? tags.filter((t): t is string => typeof t === "string")
          : undefined,
        createdByAgentId: actor.agentId ?? undefined,
        createdInRunId: actor.runId ?? undefined,
      });

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? undefined,
        runId: actor.runId ?? undefined,
        action: "memory.wiki_upserted",
        entityType: "company_memory",
        entityId: memory.id,
        details: { wikiSlug: memory.wikiSlug, contentBytes: memory.contentBytes },
      });

      res.json(memory);
    } catch (err) {
      if (err instanceof MemoryContentTooLargeError) {
        res.status(413).json({ error: "Content too large" });
        return;
      }
      throw err;
    }
  });

  router.get("/companies/:companyId/memories/wiki", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const items = await svc.wikiList(companyId);
    res.json({ items });
  });

  router.get("/companies/:companyId/memories/wiki/:slug", async (req, res) => {
    const companyId = req.params.companyId as string;
    const slug = normalizeSlug(req.params.slug as string);
    assertCompanyAccess(req, companyId);
    const memory = await svc.wikiGet(companyId, slug);
    if (!memory) {
      res.status(404).json({ error: "Wiki page not found" });
      return;
    }
    res.json(memory);
  });

  router.delete("/companies/:companyId/memories/wiki/:slug", async (req, res) => {
    const companyId = req.params.companyId as string;
    const slug = normalizeSlug(req.params.slug as string);
    assertCompanyAccess(req, companyId);

    const removed = await svc.wikiRemove(companyId, slug);
    if (!removed) {
      res.status(404).json({ error: "Wiki page not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? undefined,
      action: "memory.wiki_deleted",
      entityType: "company_memory",
      entityId: removed.id,
      details: { wikiSlug: removed.wikiSlug },
    });

    res.json(removed);
  });

  // ── Create / delete episodic memories ────────────────────────────────────

  router.post("/companies/:companyId/memories", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const { content, tags, expiresAt } = req.body as {
      content?: unknown;
      tags?: unknown;
      expiresAt?: unknown;
    };

    if (typeof content !== "string" || content.trim().length === 0) {
      res.status(400).json({ error: "Invalid body: content is required and must be a non-empty string" });
      return;
    }

    if (tags !== undefined && (!Array.isArray(tags) || tags.some((t) => typeof t !== "string"))) {
      res.status(400).json({ error: "Invalid body: tags must be an array of strings" });
      return;
    }

    let parsedExpiresAt: Date | undefined;
    if (expiresAt !== undefined) {
      if (typeof expiresAt !== "string") {
        res.status(400).json({ error: "Invalid body: expiresAt must be an ISO 8601 datetime string" });
        return;
      }
      const d = new Date(expiresAt);
      if (Number.isNaN(d.getTime())) {
        res.status(400).json({ error: "Invalid body: expiresAt is not a valid datetime" });
        return;
      }
      if (d <= new Date(Date.now() + 60_000)) {
        res.status(400).json({ error: "Invalid body: expiresAt must be at least 60 seconds in the future" });
        return;
      }
      parsedExpiresAt = d;
    }

    const actor = getActorInfo(req);
    const createdByAgentId = actor.agentId ?? undefined;

    try {
      const memory = await svc.save({
        companyId,
        content,
        tags: tags as string[] | undefined,
        createdByAgentId,
        createdInRunId: actor.runId ?? undefined,
        expiresAt: parsedExpiresAt,
      });

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? undefined,
        runId: actor.runId ?? undefined,
        action: "memory.saved",
        entityType: "company_memory",
        entityId: memory.id,
        details: { tags: memory.tags, expiresAt: memory.expiresAt },
      });

      res.status(201).json(memory);
    } catch (err) {
      if (err instanceof MemoryContentTooLargeError) {
        res.status(413).json({ error: "Content too large" });
        return;
      }
      throw err;
    }
  });

  // ── Patch episodic memory metadata ────────────────────────────────────────
  // Only tags and expiresAt may be changed. Content is immutable (tied to hash).
  // Wiki pages are excluded — use PUT /wiki/:slug to update them.

  router.patch("/companies/:companyId/memories/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);

    const body = req.body as Record<string, unknown>;
    const update: { tags?: string[]; expiresAt?: Date | null } = {};

    if (body.tags !== undefined) {
      const tags = body.tags;
      if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string")) {
        res.status(400).json({ error: "Invalid body: tags must be an array of strings" });
        return;
      }
      update.tags = tags as string[];
    }

    if ("expiresAt" in body) {
      const rawExpiry = body.expiresAt;
      if (rawExpiry === null) {
        update.expiresAt = null;
      } else if (typeof rawExpiry === "string") {
        const d = new Date(rawExpiry);
        if (Number.isNaN(d.getTime())) {
          res.status(400).json({ error: "Invalid body: expiresAt is not a valid datetime" });
          return;
        }
        if (d <= new Date(Date.now() + 60_000)) {
          res.status(400).json({ error: "Invalid body: expiresAt must be at least 60 seconds in the future" });
          return;
        }
        update.expiresAt = d;
      } else {
        res.status(400).json({ error: "Invalid body: expiresAt must be an ISO 8601 datetime string or null" });
        return;
      }
    }

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "No updatable fields supplied (tags, expiresAt)" });
      return;
    }

    // Agent tokens may only patch memories they created themselves.
    const callerAgentId =
      req.actor.type === "agent" ? req.actor.agentId ?? undefined : undefined;
    const updated = await svc.patch(id, companyId, update, callerAgentId);
    if (!updated) {
      res.status(404).json({ error: "Memory not found" });
      return;
    }

    res.json(updated);
  });

  router.delete("/companies/:companyId/memories/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);

    const deleted = await svc.remove(id, companyId);
    if (!deleted) {
      res.status(404).json({ error: "Memory not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? undefined,
      action: "memory.deleted",
      entityType: "company_memory",
      entityId: deleted.id,
    });

    res.json(deleted);
  });

  return router;
}
