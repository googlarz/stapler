/**
 * Tests for the invite-scoped anonymous skill download route
 * GET /api/invites/:token/skills/:skillName
 *
 * The route must:
 * - Return skill markdown for a valid, unexpired invite (no auth required)
 * - Return 404 for an unknown skill name
 * - Return 404 for revoked, accepted, or expired invites
 * - Return 404 for an unknown token
 */
import { randomUUID } from "node:crypto";
import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyPendingMigrations,
  companies,
  createDb,
  ensurePostgresDatabase,
  invites,
} from "@stapler/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
  type EmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { accessRoutes } from "../routes/access.js";

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping invite skill route tests: ${embeddedPostgresSupport.reason ?? "unsupported"}`,
  );
}

describeEmbeddedPostgres("GET /api/invites/:token/skills/:skillName", () => {
  let tempDb: EmbeddedPostgresTestDatabase | null = null;
  let db: ReturnType<typeof createDb>;
  let app: express.Express;
  let companyId: string;
  let validToken: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("stapler-invite-skill-route-");
    db = createDb(tempDb.connectionString);

    // Build a minimal Express app that mounts the access routes.
    app = express();
    app.use(express.json());
    // Minimal actor middleware — access routes read req.actor
    app.use((req: any, _res, next) => {
      req.actor = { type: "none" };
      next();
    });
    app.use("/api", accessRoutes(db, {
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
    }));

    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Skill Route Co",
      issuePrefix: "SKL",
      requireBoardApprovalForNewAgents: false,
    });

    validToken = randomUUID();
    await db.insert(invites).values({
      id: randomUUID(),
      companyId,
      tokenHash: hashToken(validToken),
      inviteType: "company_join",
      allowedJoinTypes: "agent",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    });
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("returns 404 for an unknown skill name", async () => {
    const res = await request(app)
      .get(`/api/invites/${validToken}/skills/nonexistent-skill`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown token", async () => {
    const res = await request(app)
      .get(`/api/invites/totally-fake-token/skills/paperclip`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for a revoked invite", async () => {
    const revokedToken = randomUUID();
    await db.insert(invites).values({
      id: randomUUID(),
      companyId,
      tokenHash: hashToken(revokedToken),
      inviteType: "company_join",
      allowedJoinTypes: "agent",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedAt: new Date(),
    });

    const res = await request(app)
      .get(`/api/invites/${revokedToken}/skills/paperclip`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for an accepted invite", async () => {
    const acceptedToken = randomUUID();
    await db.insert(invites).values({
      id: randomUUID(),
      companyId,
      tokenHash: hashToken(acceptedToken),
      inviteType: "company_join",
      allowedJoinTypes: "agent",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      acceptedAt: new Date(),
    });

    const res = await request(app)
      .get(`/api/invites/${acceptedToken}/skills/paperclip`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for an expired invite", async () => {
    const expiredToken = randomUUID();
    await db.insert(invites).values({
      id: randomUUID(),
      companyId,
      tokenHash: hashToken(expiredToken),
      inviteType: "company_join",
      allowedJoinTypes: "agent",
      expiresAt: new Date(Date.now() - 1000), // already expired
    });

    const res = await request(app)
      .get(`/api/invites/${expiredToken}/skills/paperclip`);
    expect(res.status).toBe(404);
  });
});
