/**
 * instance-skills routes
 *
 * GET    /instance/skills            — list all instance skills (authenticated)
 * GET    /instance/skills/:id        — get one by id (authenticated)
 * POST   /instance/skills/import     — import from GitHub/local path (admin only)
 * PATCH  /instance/skills/:id        — update name/description/markdown (admin only)
 * DELETE /instance/skills/:id        — delete (admin only)
 */

import { Router } from "express";
import type { Db } from "@stapler/db";
import { assertInstanceAdmin, assertBoard } from "./authz.js";
import { notFound } from "../errors.js";
import { instanceSkillService } from "../services/instance-skills.js";

export function instanceSkillRoutes(db: Db) {
  const router = Router();
  const svc = instanceSkillService(db);

  /** List all instance skills. */
  router.get("/instance/skills", async (req, res) => {
    assertBoard(req);
    const skills = await svc.list();
    res.json(skills);
  });

  /** Get a single instance skill by id. */
  router.get("/instance/skills/:id", async (req, res) => {
    assertBoard(req);
    const { id } = req.params as { id: string };
    const skill = await svc.getById(id);
    if (!skill) throw notFound("Instance skill not found");
    res.json(skill);
  });

  /**
   * Import one or more skills from a GitHub URL or local path.
   * Body: { source: string }
   *
   * Examples:
   *   { source: "https://github.com/owner/repo" }
   *   { source: "https://github.com/owner/repo --skill=plan-phase" }
   *   { source: "/absolute/path/to/skills/dir" }
   */
  router.post("/instance/skills/import", async (req, res) => {
    assertInstanceAdmin(req);
    const source = typeof req.body.source === "string" ? req.body.source.trim() : null;
    if (!source) {
      res.status(400).json({ error: "source is required (GitHub URL or local path)" });
      return;
    }
    const result = await svc.importFromSource(source);
    res.status(201).json(result);
  });

  /**
   * Update a skill's name, description, or markdown body.
   * Body: { name?: string; description?: string; markdown?: string }
   */
  router.patch("/instance/skills/:id", async (req, res) => {
    assertInstanceAdmin(req);
    const { id } = req.params as { id: string };
    const { name, description, markdown } = req.body as {
      name?: unknown;
      description?: unknown;
      markdown?: unknown;
    };
    const patch: Record<string, string | null | undefined> = {};
    if (typeof name === "string") patch.name = name.trim();
    if (description !== undefined) patch.description = typeof description === "string" ? description.trim() : null;
    if (typeof markdown === "string") patch.markdown = markdown;

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "At least one of name, description, or markdown must be provided" });
      return;
    }

    const skill = await svc.updateSkill(id, patch);
    if (!skill) throw notFound("Instance skill not found");
    res.json(skill);
  });

  /** Delete an instance skill. */
  router.delete("/instance/skills/:id", async (req, res) => {
    assertInstanceAdmin(req);
    const { id } = req.params as { id: string };
    const deleted = await svc.deleteSkill(id);
    if (!deleted) throw notFound("Instance skill not found");
    res.json({ ok: true, id: deleted.id, key: deleted.key });
  });

  return router;
}
