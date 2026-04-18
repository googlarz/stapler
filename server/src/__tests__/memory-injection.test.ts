import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb } from "@stapler/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { agentMemoryService } from "../services/agent-memories.ts";
import { companyMemoryService } from "../services/company-memories.ts";
import { maybeLoadMemoriesForInjection } from "../services/memory-injection.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping memory injection tests: ${embeddedPostgresSupport.reason ?? "unsupported"}`,
  );
}

describeEmbeddedPostgres("maybeLoadMemoriesForInjection", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId!: string;
  let agentId!: string;

  const AGENT_WITH_INJECTION = (id: string, cId: string) => ({
    id,
    companyId: cId,
    adapterConfig: { enableMemoryInjection: true },
  });

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("stapler-mem-inject-");
    db = createDb(tempDb.connectionString);

    companyId = randomUUID();
    agentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Injection Test Co",
      issuePrefix: "INJ",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Injector",
      role: "general",
      status: "active",
      adapterType: "ollama_local",
      adapterConfig: { enableMemoryInjection: true },
      runtimeConfig: {},
      permissions: {},
    });
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("returns empty array when injection is disabled", async () => {
    const agent = { id: agentId, companyId, adapterConfig: { enableMemoryInjection: false } };
    const result = await maybeLoadMemoriesForInjection(db, agent, {});
    expect(result).toEqual([]);
  });

  it("returns empty array when adapterConfig is missing", async () => {
    const agent = { id: agentId, companyId, adapterConfig: null };
    const result = await maybeLoadMemoriesForInjection(db, agent, {});
    expect(result).toEqual([]);
  });

  it("returns wiki pages when no search context is available", async () => {
    const svc = agentMemoryService(db);
    await svc.wikiUpsert({ companyId, agentId, wikiSlug: "my-page", content: "hello from wiki", tags: [] });

    const agent = AGENT_WITH_INJECTION(agentId, companyId);
    const result = await maybeLoadMemoriesForInjection(db, agent, {});

    expect(result.length).toBeGreaterThan(0);
    const wikiHit = result.find((m) => m.wikiSlug === "my-page");
    expect(wikiHit).toBeDefined();
    expect(wikiHit?.source).toBe("agent");
  });

  it("includes company wiki pages in injection", async () => {
    const companySvc = companyMemoryService(db);
    await companySvc.wikiUpsert({
      companyId,
      wikiSlug: "company-guide",
      content: "Company style guide content",
      tags: [],
    });

    const agent = AGENT_WITH_INJECTION(agentId, companyId);
    const result = await maybeLoadMemoriesForInjection(db, agent, {});

    const companyWikiHit = result.find((m) => m.wikiSlug === "company-guide");
    expect(companyWikiHit).toBeDefined();
    expect(companyWikiHit?.source).toBe("company");
  });

  it("returns episodic memories when search context is provided", async () => {
    const svc = agentMemoryService(db);
    await svc.save({ companyId, agentId, content: "Use vitest for testing", tags: ["testing"] });

    const agent = AGENT_WITH_INJECTION(agentId, companyId);
    const result = await maybeLoadMemoriesForInjection(db, agent, {
      wakeReason: "writing tests",
    });

    const episodic = result.filter((m) => !m.wikiSlug && m.source === "agent");
    expect(episodic.length).toBeGreaterThan(0);
  });

  it("does not include expired episodic memories", async () => {
    const svc = agentMemoryService(db);
    const { memory } = await svc.save({
      companyId,
      agentId,
      content: "This expired memory should not appear",
      tags: [],
      expiresAt: new Date(Date.now() - 5000),
    });

    const agent = AGENT_WITH_INJECTION(agentId, companyId);
    const result = await maybeLoadMemoriesForInjection(db, agent, {
      wakeReason: "expired memory check",
    });

    expect(result.some((m) => m.id === memory.id)).toBe(false);
  });
});
