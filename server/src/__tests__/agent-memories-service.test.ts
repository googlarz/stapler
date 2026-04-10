import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agentMemories,
  agents,
  companies,
  createDb,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  agentMemoryService,
  MemoryContentTooLargeError,
} from "../services/agent-memories.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres agent-memory service tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

describeEmbeddedPostgres("agentMemoryService", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof agentMemoryService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId!: string;
  let agentIdA!: string;
  let agentIdB!: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-memory-service-");
    db = createDb(tempDb.connectionString);
    svc = agentMemoryService(db);

    companyId = randomUUID();
    agentIdA = randomUUID();
    agentIdB = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Memory Test Co",
      issuePrefix: "MEM",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: agentIdA,
        companyId,
        name: "Alice",
        role: "general",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: agentIdB,
        companyId,
        name: "Bob",
        role: "general",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  // Clean memory table between tests so each test starts fresh.
  afterEach(async () => {
    await db.delete(agentMemories);
    delete process.env.PAPERCLIP_MEMORY_MAX_PER_AGENT;
    delete process.env.PAPERCLIP_MEMORY_MAX_CONTENT_BYTES;
    delete process.env.PAPERCLIP_MEMORY_SEARCH_THRESHOLD;
  });

  describe("save", () => {
    it("inserts a memory and returns deduped: false on first save", async () => {
      const result = await svc.save({
        companyId,
        agentId: agentIdA,
        content: "user prefers French over English",
        tags: ["preference", "language"],
      });
      expect(result.deduped).toBe(false);
      expect(result.memory.agentId).toBe(agentIdA);
      expect(result.memory.companyId).toBe(companyId);
      expect(result.memory.content).toBe("user prefers French over English");
      expect(result.memory.tags).toEqual(["preference", "language"]);
      expect(result.memory.contentBytes).toBe(
        Buffer.byteLength("user prefers French over English", "utf8"),
      );
      expect(result.memory.contentHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("trims whitespace and uses trimmed content for hashing (dedupe)", async () => {
      const a = await svc.save({ companyId, agentId: agentIdA, content: "hello world" });
      const b = await svc.save({ companyId, agentId: agentIdA, content: "  hello world  " });
      expect(a.deduped).toBe(false);
      expect(b.deduped).toBe(true);
      expect(b.memory.id).toBe(a.memory.id);
    });

    it("dedupes across two calls with identical content", async () => {
      const first = await svc.save({
        companyId,
        agentId: agentIdA,
        content: "alpha beta",
      });
      const second = await svc.save({
        companyId,
        agentId: agentIdA,
        content: "alpha beta",
      });
      expect(first.deduped).toBe(false);
      expect(second.deduped).toBe(true);
      expect(second.memory.id).toBe(first.memory.id);
      const count = await svc.countForAgent(agentIdA);
      expect(count).toBe(1);
    });

    it("does not dedupe across agents with the same content", async () => {
      const forA = await svc.save({
        companyId,
        agentId: agentIdA,
        content: "same note",
      });
      const forB = await svc.save({
        companyId,
        agentId: agentIdB,
        content: "same note",
      });
      expect(forA.deduped).toBe(false);
      expect(forB.deduped).toBe(false);
      expect(forA.memory.id).not.toBe(forB.memory.id);
    });

    it("throws MemoryContentTooLargeError when content exceeds byte limit", async () => {
      process.env.PAPERCLIP_MEMORY_MAX_CONTENT_BYTES = "16";
      await expect(
        svc.save({
          companyId,
          agentId: agentIdA,
          content: "this is way longer than sixteen bytes",
        }),
      ).rejects.toBeInstanceOf(MemoryContentTooLargeError);
    });

    it("rejects empty / whitespace-only content", async () => {
      await expect(
        svc.save({ companyId, agentId: agentIdA, content: "   " }),
      ).rejects.toThrow(/empty/);
    });

    it("prunes oldest memories when cap is exceeded", async () => {
      process.env.PAPERCLIP_MEMORY_MAX_PER_AGENT = "3";
      for (let i = 0; i < 5; i += 1) {
        await svc.save({
          companyId,
          agentId: agentIdA,
          content: `memory-${i}`,
        });
        // Force distinct created_at so oldest-first ordering is deterministic.
        await new Promise((r) => setTimeout(r, 5));
      }
      const count = await svc.countForAgent(agentIdA);
      expect(count).toBe(3);

      const remaining = await svc.list({ agentId: agentIdA, limit: 10 });
      const contents = remaining.map((m) => m.content).sort();
      expect(contents).toEqual(["memory-2", "memory-3", "memory-4"]);
    });

    it("pruning does not touch another agent's memories", async () => {
      process.env.PAPERCLIP_MEMORY_MAX_PER_AGENT = "2";
      await svc.save({ companyId, agentId: agentIdA, content: "a-one" });
      await svc.save({ companyId, agentId: agentIdB, content: "b-one" });
      await svc.save({ companyId, agentId: agentIdB, content: "b-two" });
      await svc.save({ companyId, agentId: agentIdA, content: "a-two" });
      await svc.save({ companyId, agentId: agentIdA, content: "a-three" });
      expect(await svc.countForAgent(agentIdA)).toBe(2);
      expect(await svc.countForAgent(agentIdB)).toBe(2);
    });

    it("dedupes tags within a single save", async () => {
      const result = await svc.save({
        companyId,
        agentId: agentIdA,
        content: "tag dedupe test",
        tags: ["foo", "foo", "bar", "bar", "foo"],
      });
      expect(result.memory.tags.sort()).toEqual(["bar", "foo"]);
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      await svc.save({
        companyId,
        agentId: agentIdA,
        content: "user prefers French over English",
        tags: ["language"],
      });
      await svc.save({
        companyId,
        agentId: agentIdA,
        content: "meeting with Alice tomorrow at 3pm",
        tags: ["calendar"],
      });
      await svc.save({
        companyId,
        agentId: agentIdA,
        content: "remember to buy flowers",
      });
      await svc.save({
        companyId,
        agentId: agentIdB,
        content: "user prefers French over English",
      });
    });

    it("returns empty array for empty query", async () => {
      const results = await svc.search({ agentId: agentIdA, q: "" });
      expect(results).toEqual([]);
    });

    it("finds the matching memory and ranks by similarity", async () => {
      const results = await svc.search({ agentId: agentIdA, q: "french english" });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content.toLowerCase()).toContain("french");
      expect(results[0].score).toBeGreaterThan(0);
    });

    it("only returns memories for the given agent", async () => {
      const results = await svc.search({ agentId: agentIdA, q: "french english" });
      for (const r of results) {
        expect(r.agentId).toBe(agentIdA);
      }
    });

    it("filters by required tags (AND semantics)", async () => {
      const results = await svc.search({
        agentId: agentIdA,
        q: "french english",
        tags: ["language"],
      });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.tags).toContain("language");
      }

      const empty = await svc.search({
        agentId: agentIdA,
        q: "french english",
        tags: ["calendar"],
      });
      expect(empty).toEqual([]);
    });
  });

  describe("list", () => {
    it("returns most-recent first", async () => {
      const a = await svc.save({ companyId, agentId: agentIdA, content: "first" });
      await new Promise((r) => setTimeout(r, 10));
      const b = await svc.save({ companyId, agentId: agentIdA, content: "second" });
      const items = await svc.list({ agentId: agentIdA });
      expect(items[0].id).toBe(b.memory.id);
      expect(items[1].id).toBe(a.memory.id);
    });

    it("filters by tags", async () => {
      await svc.save({
        companyId,
        agentId: agentIdA,
        content: "tagged memory",
        tags: ["important"],
      });
      await svc.save({ companyId, agentId: agentIdA, content: "untagged memory" });

      const tagged = await svc.list({ agentId: agentIdA, tags: ["important"] });
      expect(tagged).toHaveLength(1);
      expect(tagged[0].content).toBe("tagged memory");
    });

    it("does not leak memories from other agents", async () => {
      await svc.save({ companyId, agentId: agentIdA, content: "agent A memory" });
      await svc.save({ companyId, agentId: agentIdB, content: "agent B memory" });
      const listA = await svc.list({ agentId: agentIdA });
      expect(listA).toHaveLength(1);
      expect(listA[0].agentId).toBe(agentIdA);
    });
  });

  describe("getById + remove + countForAgent", () => {
    it("getById returns the row or null", async () => {
      const saved = await svc.save({
        companyId,
        agentId: agentIdA,
        content: "fetchable",
      });
      const fetched = await svc.getById(saved.memory.id);
      expect(fetched?.id).toBe(saved.memory.id);
      const missing = await svc.getById(randomUUID());
      expect(missing).toBeNull();
    });

    it("remove deletes the row and returns it", async () => {
      const saved = await svc.save({
        companyId,
        agentId: agentIdA,
        content: "to be removed",
      });
      const removed = await svc.remove(saved.memory.id);
      expect(removed?.id).toBe(saved.memory.id);
      const after = await svc.getById(saved.memory.id);
      expect(after).toBeNull();
    });

    it("countForAgent returns 0 for an agent with no memories", async () => {
      expect(await svc.countForAgent(agentIdA)).toBe(0);
    });

    it("countForAgent reflects inserts and deletes", async () => {
      await svc.save({ companyId, agentId: agentIdA, content: "one" });
      await svc.save({ companyId, agentId: agentIdA, content: "two" });
      expect(await svc.countForAgent(agentIdA)).toBe(2);
      const items = await svc.list({ agentId: agentIdA });
      await svc.remove(items[0].id);
      expect(await svc.countForAgent(agentIdA)).toBe(1);
    });

    it("remove of a non-existent id returns null", async () => {
      const res = await svc.remove(randomUUID());
      expect(res).toBeNull();
    });
  });

  describe("row shape", () => {
    it("surfaces tags as an array even when the jsonb default fires", async () => {
      const saved = await svc.save({
        companyId,
        agentId: agentIdA,
        content: "untagged row",
      });
      expect(saved.memory.tags).toEqual([]);
      const direct = await db
        .select()
        .from(agentMemories)
        .where(eq(agentMemories.id, saved.memory.id));
      expect(direct[0]?.tags).toEqual([]);
    });
  });
});
