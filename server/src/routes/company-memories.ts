import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { companyMemoryService, MemoryContentTooLargeError } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

/**
 * Company memory routes. All routes are scoped to `/companies/:companyId/memories`
 * and enforce company-level authorization — any agent or board user with access
 * to the company may read and write shared memories.
 */
export function companyMemoryRoutes(db: Db) {
  const router = Router();
  const svc = companyMemoryService(db);

  router.get("/companies/:companyId/memories", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const rawTags = req.query.tags as string | undefined;
    const rawLimit = req.query.limit as string | undefined;
    const rawOffset = req.query.offset as string | undefined;

    let tags: string[] | undefined;
    if (rawTags !== undefined) {
      tags = rawTags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
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
    res.json({ items });
  });

  router.post("/companies/:companyId/memories", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const { content, tags } = req.body as { content?: unknown; tags?: unknown };

    if (typeof content !== "string" || content.trim().length === 0) {
      res.status(400).json({ error: "Invalid body: content is required and must be a non-empty string" });
      return;
    }

    if (tags !== undefined && (!Array.isArray(tags) || tags.some((t) => typeof t !== "string"))) {
      res.status(400).json({ error: "Invalid body: tags must be an array of strings" });
      return;
    }

    const actor = getActorInfo(req);
    const createdByAgentId = actor.agentId ?? undefined;

    try {
      const memory = await svc.save({
        companyId,
        content,
        tags: tags as string[] | undefined,
        createdByAgentId,
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

  return router;
}
