import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companyMemories, companies, createDb } from "@stapler/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { companyMemoryService } from "../services/company-memories.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping company-memory service tests: ${embeddedPostgresSupport.reason ?? "unsupported"}`,
  );
}

describeEmbeddedPostgres("companyMemoryService", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof companyMemoryService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId!: string;
  let agentIdA!: string;
  let agentIdB!: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("stapler-company-memory-svc-");
    db = createDb(tempDb.connectionString);
    svc = companyMemoryService(db);

    companyId = randomUUID();
    agentIdA = randomUUID();
    agentIdB = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Co Memory Test",
      issuePrefix: "CMT",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: agentIdA,
        companyId,
        name: "Agent A",
        role: "general",
        status: "active",
        adapterType: "ollama_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: agentIdB,
        companyId,
        name: "Agent B",
        role: "general",
        status: "active",
        adapterType: "ollama_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(companyMemories);
    await tempDb?.cleanup();
  });

  describe("save / list (episodic)", () => {
    it("saves a memory and returns it in list", async () => {
      const memory = await svc.save({
        companyId,
        content: "Use pnpm, not npm",
        tags: ["tooling"],
        createdByAgentId: agentIdA,
      });
      expect(memory.content).toBe("Use pnpm, not npm");
      expect(memory.tags).toEqual(["tooling"]);

      const listed = await svc.list({ companyId });
      expect(listed.some((m) => m.id === memory.id)).toBe(true);
    });

    it("deduplicates identical content within the same company", async () => {
      const first = await svc.save({
        companyId,
        content: "Unique dedup content",
        tags: [],
      });
      const second = await svc.save({
        companyId,
        content: "Unique dedup content",
        tags: ["extra"],
      });
      expect(second.id).toBe(first.id);
    });

    it("does not return expired memories", async () => {
      const memory = await svc.save({
        companyId,
        content: "Already expired memory",
        tags: [],
        expiresAt: new Date(Date.now() - 1000),
      });
      const listed = await svc.list({ companyId });
      expect(listed.some((m) => m.id === memory.id)).toBe(false);
    });
  });

  describe("wiki upsert", () => {
    it("creates and updates a wiki page by slug", async () => {
      const slug = "style-guide";
      const first = await svc.wikiUpsert({
        companyId,
        wikiSlug: slug,
        content: "v1 content",
        tags: ["docs"],
      });
      expect(first.wikiSlug).toBe(slug);

      const second = await svc.wikiUpsert({
        companyId,
        wikiSlug: slug,
        content: "v2 content",
        tags: ["docs", "updated"],
      });
      expect(second.id).toBe(first.id);
      expect(second.content).toBe("v2 content");
    });

    it("returns wiki pages in wikiList", async () => {
      const pages = await svc.wikiList(companyId);
      expect(pages.some((p) => p.wikiSlug === "style-guide")).toBe(true);
    });
  });

  describe("patch (ownership)", () => {
    it("allows board callers to patch any episodic memory", async () => {
      const memory = await svc.save({
        companyId,
        content: "Board patchable memory",
        tags: [],
        createdByAgentId: agentIdA,
      });
      const patched = await svc.patch(memory.id, companyId, { tags: ["board-edit"] });
      expect(patched?.tags).toEqual(["board-edit"]);
    });

    it("allows the owning agent to patch its own memory", async () => {
      const memory = await svc.save({
        companyId,
        content: "Agent A owns this",
        tags: [],
        createdByAgentId: agentIdA,
      });
      const patched = await svc.patch(memory.id, companyId, { tags: ["mine"] }, agentIdA);
      expect(patched?.tags).toEqual(["mine"]);
    });

    it("blocks a different agent from patching another agent's memory", async () => {
      const memory = await svc.save({
        companyId,
        content: "Agent A exclusive content xyz",
        tags: [],
        createdByAgentId: agentIdA,
      });
      const patched = await svc.patch(memory.id, companyId, { tags: ["hijacked"] }, agentIdB);
      expect(patched).toBeNull();
    });

    it("returns null for a non-existent memory id", async () => {
      const result = await svc.patch(randomUUID(), companyId, { tags: ["x"] });
      expect(result).toBeNull();
    });
  });
});
