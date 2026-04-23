/**
 * skill-invocations routes
 *
 * GET /api/skill-invocations/:id          — fetch a single invocation by id
 * GET /api/issues/:id/skill-invocations   — list all invocations for an issue
 */

import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@stapler/db";
import { issues, skillInvocations } from "@stapler/db";
import { assertCompanyAccess } from "./authz.js";
import { notFound } from "../errors.js";

export function skillInvocationRoutes(db: Db) {
  const router = Router();

  /** Fetch a single skill invocation by id. */
  router.get("/skill-invocations/:id", async (req, res) => {
    const { id } = req.params as { id: string };
    const rows = await db
      .select()
      .from(skillInvocations)
      .where(eq(skillInvocations.id, id))
      .limit(1);

    const invocation = rows[0];
    if (!invocation) throw notFound("Skill invocation not found");
    assertCompanyAccess(req, invocation.companyId);
    res.json(invocation);
  });

  /** List all skill invocations for an issue, newest first. */
  router.get("/issues/:id/skill-invocations", async (req, res) => {
    const { id: issueId } = req.params as { id: string };

    // Verify the issue exists and the requester has company access.
    const issueRows = await db
      .select({ companyId: issues.companyId })
      .from(issues)
      .where(eq(issues.id, issueId))
      .limit(1);

    const issue = issueRows[0];
    if (!issue) throw notFound("Issue not found");
    assertCompanyAccess(req, issue.companyId);

    const rows = await db
      .select()
      .from(skillInvocations)
      .where(eq(skillInvocations.issueId, issueId))
      .orderBy(desc(skillInvocations.createdAt));

    res.json(rows);
  });

  return router;
}
