import { Router } from "express";
import { eq, and } from "drizzle-orm";
import type { Db } from "@stapler/db";
import { agents } from "@stapler/db";
import { outputService, issueService, logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logger } from "../middleware/logger.js";

export function outputRoutes(db: Db) {
  const router = Router();
  const svc = outputService(db);

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------

  router.get("/companies/:companyId/outputs", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await svc.list(companyId);
    res.json(result);
  });

  // ---------------------------------------------------------------------------
  // Get by id (with versions)
  // ---------------------------------------------------------------------------

  router.get("/outputs/:id", async (req, res) => {
    const id = req.params.id as string;
    const output = await svc.getById(id);
    if (!output) {
      res.status(404).json({ error: "Output not found" });
      return;
    }
    assertCompanyAccess(req, output.companyId);
    const versions = await svc.getVersions(id);
    res.json({ ...output, versions });
  });

  // ---------------------------------------------------------------------------
  // Propose (create + CEO approval issue)
  // ---------------------------------------------------------------------------

  router.post("/companies/:companyId/outputs", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const { title, description } = req.body as { title?: unknown; description?: unknown };
    if (typeof title !== "string" || title.trim().length === 0) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    const actor = getActorInfo(req);

    const output = await svc.create(companyId, {
      title: title.trim(),
      description: typeof description === "string" ? description.trim() : undefined,
      proposedByAgentId: actor.agentId ?? undefined,
    });

    // Create a CEO approval issue so the CEO is notified and can approve.
    const ceoAgent = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.role, "ceo")))
      .then((rows) => rows[0] ?? null);

    if (ceoAgent) {
      try {
        const issueSvc = issueService(db);
        const approvalIssue = await issueSvc.create(companyId, {
          title: `Approve output: ${output.title}`,
          description: [
            `An agent has proposed a new company output that requires your approval.`,
            ``,
            `**Output:** ${output.title}`,
            description ? `**Description:** ${description}` : null,
            ``,
            `To approve, call \`PATCH /api/outputs/${output.id}\` with \`{"status":"active","approvedByAgentId":"<your-agent-id>"}\`, `,
            `or use the \`paperclip_approve_output\` tool with \`outputId: "${output.id}"\`.`,
            ``,
            `To reject, simply mark this issue as cancelled.`,
          ]
            .filter((l) => l !== null)
            .join("\n"),
          status: "todo",
          assigneeAgentId: ceoAgent.id,
          priority: "medium",
        });

        // Link approval issue back to the output.
        await svc.update(output.id, { approvalIssueId: approvalIssue.id });
        output.approvalIssueId = approvalIssue.id;
      } catch (err) {
        logger.warn({ err }, "outputs: could not create CEO approval issue");
      }
    }

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? undefined,
      runId: actor.runId ?? undefined,
      action: "output.proposed",
      entityType: "output",
      entityId: output.id,
      details: { title: output.title },
    });

    res.status(201).json(output);
  });

  // ---------------------------------------------------------------------------
  // Update title / description / status
  // ---------------------------------------------------------------------------

  router.patch("/outputs/:id", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Output not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);

    const { title, description, status } = req.body as {
      title?: unknown;
      description?: unknown;
      status?: unknown;
    };

    const updates: Record<string, unknown> = {};
    if (typeof title === "string") updates.title = title.trim();
    if (typeof description === "string") updates.description = description.trim();
    if (typeof status === "string") updates.status = status;

    const output = await svc.update(id, updates);
    if (!output) {
      res.status(404).json({ error: "Output not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: output.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? undefined,
      runId: actor.runId ?? undefined,
      action: "output.updated",
      entityType: "output",
      entityId: output.id,
      details: updates,
    });

    res.json(output);
  });

  // ---------------------------------------------------------------------------
  // Update draft
  // ---------------------------------------------------------------------------

  router.patch("/outputs/:id/draft", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Output not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);

    const { content } = req.body as { content?: unknown };
    if (typeof content !== "string") {
      res.status(400).json({ error: "content must be a string" });
      return;
    }

    const output = await svc.updateDraft(id, content);
    if (!output) {
      res.status(404).json({ error: "Output not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: output.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? undefined,
      runId: actor.runId ?? undefined,
      action: "output.draft_updated",
      entityType: "output",
      entityId: output.id,
    });

    res.json(output);
  });

  // ---------------------------------------------------------------------------
  // Approve
  // ---------------------------------------------------------------------------

  router.post("/outputs/:id/approve", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Output not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);

    const actor = getActorInfo(req);
    const approverId = actor.agentId ?? actor.actorId;
    const output = await svc.approve(id, approverId);
    if (!output) {
      res.status(404).json({ error: "Output not found" });
      return;
    }

    await logActivity(db, {
      companyId: output.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? undefined,
      runId: actor.runId ?? undefined,
      action: "output.approved",
      entityType: "output",
      entityId: output.id,
    });

    res.json(output);
  });

  // ---------------------------------------------------------------------------
  // Release new version
  // ---------------------------------------------------------------------------

  router.post("/outputs/:id/versions", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Output not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);

    if (existing.status !== "active") {
      res.status(409).json({ error: "Only active outputs can have versions released" });
      return;
    }

    if (!existing.draftContent.trim()) {
      res.status(409).json({ error: "Draft is empty — write something before releasing" });
      return;
    }

    const { releaseNotes } = req.body as { releaseNotes?: unknown };
    const actor = getActorInfo(req);

    const version = await svc.releaseVersion(id, {
      releasedByAgentId: actor.agentId ?? undefined,
      releaseNotes: typeof releaseNotes === "string" ? releaseNotes.trim() : undefined,
    });

    if (!version) {
      res.status(404).json({ error: "Output not found" });
      return;
    }

    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? undefined,
      runId: actor.runId ?? undefined,
      action: "output.version_released",
      entityType: "output",
      entityId: id,
      details: { versionNumber: version.versionNumber },
    });

    res.status(201).json(version);
  });

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  router.delete("/outputs/:id", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Output not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);

    const output = await svc.remove(id);
    if (!output) {
      res.status(404).json({ error: "Output not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: output.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? undefined,
      runId: actor.runId ?? undefined,
      action: "output.deleted",
      entityType: "output",
      entityId: output.id,
    });

    res.json(output);
  });

  return router;
}
