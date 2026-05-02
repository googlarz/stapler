import type { Request } from "express";
import { forbidden, unauthorized } from "../errors.js";

export function assertAuthenticated(req: Request) {
  if (req.actor.type === "none") {
    throw unauthorized();
  }
}

export function assertBoard(req: Request) {
  if (req.actor.type !== "board") {
    throw forbidden("Board access required");
  }
}

export function hasBoardOrgAccess(req: Request) {
  if (req.actor.type !== "board") {
    return false;
  }
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    return true;
  }
  return Array.isArray(req.actor.companyIds) && req.actor.companyIds.length > 0;
}

export function assertBoardOrgAccess(req: Request) {
  assertBoard(req);
  if (hasBoardOrgAccess(req)) {
    return;
  }
  throw forbidden("Company membership or instance admin access required");
}

export function assertInstanceAdmin(req: Request) {
  assertBoard(req);
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    return;
  }
  throw forbidden("Instance admin access required");
}

export function assertCompanyAccess(req: Request, companyId: string) {
  assertAuthenticated(req);
  if (req.actor.type === "agent" && req.actor.companyId !== companyId) {
    throw forbidden("Agent key cannot access another company");
  }
  if (req.actor.type === "board" && req.actor.source !== "local_implicit") {
    const allowedCompanies = req.actor.companyIds ?? [];
    if (!allowedCompanies.includes(companyId)) {
      throw forbidden("User does not have access to this company");
    }
    const method = typeof req.method === "string" ? req.method.toUpperCase() : "GET";
    const isSafeMethod = ["GET", "HEAD", "OPTIONS"].includes(method);
    if (!isSafeMethod && !req.actor.isInstanceAdmin && Array.isArray(req.actor.memberships)) {
      const membership = req.actor.memberships.find((item) => item.companyId === companyId);
      if (!membership || membership.status !== "active") {
        throw forbidden("User does not have active company access");
      }
      if (membership.membershipRole === "viewer") {
        throw forbidden("Viewer access is read-only");
      }
    }
  }
}

/**
 * Enforce that the request actor is the exact agent identified by
 * `agentId`. Agent keys may only act on their own resources; board
 * actors pass through (they should have gone through
 * `assertCompanyAccess` first to enforce the company boundary).
 *
 * Used by the agent memory routes to close the `paperclipApiRequest`
 * escape hatch: the raw-API tool can construct any URL, but this
 * guard rejects `/agents/OTHER_ID/...` calls made with agent X's key
 * because `req.actor.agentId` is resolved from the token (see
 * `server/src/middleware/auth.ts`), not from the URL.
 *
 * Board actors: any board user who passes `assertCompanyAccess` can
 * read, write, and delete memories for any agent within that company.
 * This is intentional — board users are administrators of the company
 * and are trusted to manage agent data. If you need finer-grained
 * board-to-agent access control (e.g. read-only for non-owner board
 * users), add a dedicated permission check here before this guard is
 * called.
 */
export function assertAgentIdentity(req: Request, agentId: string) {
  if (req.actor.type === "none") {
    throw unauthorized();
  }
  if (req.actor.type === "agent" && req.actor.agentId !== agentId) {
    throw forbidden("Agent key can only act on its own resources");
  }
}

export function getActorInfo(req: Request) {
  assertAuthenticated(req);
  if (req.actor.type === "agent") {
    return {
      actorType: "agent" as const,
      actorId: req.actor.agentId ?? "unknown-agent",
      agentId: req.actor.agentId ?? null,
      runId: req.actor.runId ?? null,
    };
  }

  return {
    actorType: "user" as const,
    actorId: req.actor.userId ?? "board",
    agentId: null,
    runId: req.actor.runId ?? null,
  };
}
