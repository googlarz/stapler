/**
 * Regression test: when a deferred comment wake is promoted after the primary
 * run closes the issue (sets status="done"), releaseIssueExecutionAndPromote
 * must reopen the issue to "in_progress" so that claimQueuedRun doesn't
 * immediately cancel the promoted run.
 *
 * This test covers the fix added in the "fix: cherry-pick upstream fixes"
 * commit where the issue reopen was moved after agent invokability checks.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { eq } from "drizzle-orm";
import { WebSocketServer } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  agentWakeupRequests,
  applyPendingMigrations,
  companies,
  createDb,
  ensurePostgresDatabase,
  heartbeatRuns,
  issueComments,
  issues,
} from "@stapler/db";
import { heartbeatService } from "../services/heartbeat.ts";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};
type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
  initdbFlags?: string[];
  onLog?: (message: unknown) => void;
  onError?: (message: unknown) => void;
}) => EmbeddedPostgresInstance;

async function getEmbeddedPostgresCtor(): Promise<EmbeddedPostgresCtor> {
  const mod = await import("embedded-postgres");
  return mod.default as EmbeddedPostgresCtor;
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") { server.close(() => reject(new Error("No port"))); return; }
      server.close((err) => err ? reject(err) : resolve(addr.port));
    });
  });
}

async function startTempDatabase() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stapler-issue-reopen-"));
  const port = await getAvailablePort();
  const EmbeddedPostgres = await getEmbeddedPostgresCtor();
  const instance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "paperclip",
    password: "paperclip",
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"],
    onLog: () => {},
    onError: () => {},
  });
  await instance.initialise();
  await instance.start();
  const adminConnectionString = `postgres://paperclip:paperclip@127.0.0.1:${port}/postgres`;
  await ensurePostgresDatabase(adminConnectionString, "paperclip");
  const connectionString = `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
  await applyPendingMigrations(connectionString);
  return { connectionString, instance, dataDir };
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timed out waiting for condition");
}

/**
 * Creates a controlled gateway that uses the two-phase openclaw protocol:
 * - `agent` call → immediately returns "accepted"
 * - `agent.wait` call → holds until released, then returns success
 */
async function createControlledGatewayServer() {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  const agentPayloads: Array<Record<string, unknown>> = [];
  let firstWaitRelease: (() => void) | null = null;
  let firstWaitGate = new Promise<void>((resolve) => {
    firstWaitRelease = resolve;
  });
  let waitCount = 0;

  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "nonce-1" } }));
    socket.on("message", async (raw) => {
      const frame = JSON.parse(Buffer.isBuffer(raw) ? raw.toString() : String(raw)) as {
        type: string; id: string; method: string; params?: Record<string, unknown>;
      };
      if (frame.type !== "req") return;

      if (frame.method === "connect") {
        socket.send(JSON.stringify({
          type: "res", id: frame.id, ok: true,
          payload: { type: "hello-ok", protocol: 3, server: { version: "test", connId: "c1" },
            features: { methods: ["connect", "agent", "agent.wait"], events: ["agent"] },
            snapshot: { version: 1, ts: Date.now() },
            policy: { maxPayload: 1_000_000, maxBufferedBytes: 1_000_000, tickIntervalMs: 30_000 } },
        }));
        return;
      }

      if (frame.method === "agent") {
        agentPayloads.push((frame.params ?? {}) as Record<string, unknown>);
        const runId = typeof frame.params?.idempotencyKey === "string"
          ? frame.params.idempotencyKey : `run-${agentPayloads.length}`;
        socket.send(JSON.stringify({
          type: "res", id: frame.id, ok: true,
          payload: { runId, status: "accepted", acceptedAt: Date.now() },
        }));
        return;
      }

      if (frame.method === "agent.wait") {
        waitCount += 1;
        if (waitCount === 1) {
          await firstWaitGate;
        }
        socket.send(JSON.stringify({
          type: "res", id: frame.id, ok: true,
          payload: { runId: frame.params?.runId, status: "ok", startedAt: 1, endedAt: 2 },
        }));
        return;
      }

      socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: {} }));
    });
  });

  const port = await getAvailablePort();
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return {
    url: `ws://127.0.0.1:${port}`,
    getAgentPayloads: () => agentPayloads,
    releaseFirstWait: () => {
      firstWaitRelease?.();
      firstWaitRelease = null;
      firstWaitGate = Promise.resolve();
    },
    close: async () => {
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

let tempDb: { connectionString: string; instance: EmbeddedPostgresInstance; dataDir: string } | null = null;
let db: ReturnType<typeof createDb>;

let embeddedSupported = false;
try {
  await import("embedded-postgres");
  embeddedSupported = true;
} catch {
  console.warn("Skipping heartbeat-issue-reopen tests: embedded-postgres not available");
}

const describeEP = embeddedSupported ? describe : describe.skip;

describeEP("heartbeat: issue reopen on deferred wake promotion", () => {
  beforeAll(async () => {
    tempDb = await startTempDatabase();
    db = createDb(tempDb.connectionString);
  }, 45_000);

  afterAll(async () => {
    await tempDb?.instance.stop();
    if (tempDb?.dataDir) {
      fs.rmSync(tempDb.dataDir, { recursive: true, force: true });
    }
  });

  it("reopens a done issue when a deferred comment wake is promoted", async () => {
    const gateway = await createControlledGatewayServer();
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const heartbeat = heartbeatService(db);

    try {
      await db.insert(companies).values({
        id: companyId, name: "Reopen Co", issuePrefix,
        requireBoardApprovalForNewAgents: false,
      });
      await db.insert(agents).values({
        id: agentId, companyId, name: "Reopen Agent", role: "engineer",
        status: "idle", adapterType: "openclaw_gateway",
        adapterConfig: {
          url: gateway.url,
          headers: { "x-openclaw-token": "t" },
          payloadTemplate: { message: "wake now" },
          waitTimeoutMs: 2_000,
        },
        runtimeConfig: {}, permissions: {},
      });
      await db.insert(issues).values({
        id: issueId, companyId, title: "Issue that will be closed mid-flight",
        status: "todo", priority: "medium", assigneeAgentId: agentId,
        issueNumber: 1, identifier: `${issuePrefix}-1`,
      });

      // First comment wakes the agent (run starts, gateway holds it)
      const comment1 = await db.insert(issueComments).values({
        companyId, issueId, authorUserId: "u1", body: "First comment",
      }).returning().then((r) => r[0]);
      const firstRun = await heartbeat.wakeup(agentId, {
        source: "automation", triggerDetail: "system", reason: "issue_commented",
        payload: { issueId, commentId: comment1.id },
        contextSnapshot: { issueId, taskId: issueId, commentId: comment1.id, wakeReason: "issue_commented" },
        requestedByActorType: "user", requestedByActorId: "u1",
      });
      expect(firstRun).not.toBeNull();

      // Wait for first gateway agent call
      await waitFor(() => gateway.getAgentPayloads().length === 1, 15_000);

      // Second comment while first run is active → should be deferred
      const comment2 = await db.insert(issueComments).values({
        companyId, issueId, authorUserId: "u1", body: "Follow-up while you're working",
      }).returning().then((r) => r[0]);
      const deferredResult = await heartbeat.wakeup(agentId, {
        source: "automation", triggerDetail: "system", reason: "issue_commented",
        payload: { issueId, commentId: comment2.id },
        contextSnapshot: { issueId, taskId: issueId, commentId: comment2.id, wakeReason: "issue_commented" },
        requestedByActorType: "user", requestedByActorId: "u1",
      });
      expect(deferredResult).toBeNull(); // correctly deferred

      // Verify the deferred wake request was stored
      await waitFor(async () => {
        const deferred = await db.select().from(agentWakeupRequests)
          .where(eq(agentWakeupRequests.agentId, agentId))
          .then((rows) => rows.find((r) => r.status === "deferred_issue_execution") ?? null);
        return Boolean(deferred);
      });

      // Operator closes the issue while the agent is still running
      await db.update(issues).set({
        status: "done", completedAt: new Date(),
        executionRunId: null, executionAgentNameKey: null, executionLockedAt: null,
        updatedAt: new Date(),
      }).where(eq(issues.id, issueId));

      // Release the gate → firstRun completes → promotion should reopen the issue
      gateway.releaseFirstWait();

      // Wait for a second gateway invocation (promoted deferred wake)
      await waitFor(() => gateway.getAgentPayloads().length === 2, 90_000);

      // Issue should be back to in_progress
      const reopenedIssue = await db.select({ status: issues.status, completedAt: issues.completedAt })
        .from(issues).where(eq(issues.id, issueId)).then((r) => r[0] ?? null);
      expect(reopenedIssue?.status).toBe("in_progress");
      expect(reopenedIssue?.completedAt).toBeNull();

      // Both runs should have succeeded
      await waitFor(async () => {
        const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, agentId));
        return runs.length === 2 && runs.every((r) => r.status === "succeeded");
      }, 90_000);
    } finally {
      gateway.releaseFirstWait();
      await gateway.close();
    }
  }, 120_000);

  it("does not reopen a done issue when the deferred agent is paused", async () => {
    const gateway = await createControlledGatewayServer();
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const heartbeat = heartbeatService(db);

    try {
      await db.insert(companies).values({
        id: companyId, name: "Paused Co", issuePrefix,
        requireBoardApprovalForNewAgents: false,
      });
      await db.insert(agents).values({
        id: agentId, companyId, name: "Paused Agent", role: "engineer",
        status: "idle", adapterType: "openclaw_gateway",
        adapterConfig: {
          url: gateway.url,
          headers: { "x-openclaw-token": "t" },
          payloadTemplate: { message: "wake now" },
          waitTimeoutMs: 2_000,
        },
        runtimeConfig: {}, permissions: {},
      });
      await db.insert(issues).values({
        id: issueId, companyId, title: "Issue with paused agent",
        status: "todo", priority: "medium", assigneeAgentId: agentId,
        issueNumber: 1, identifier: `${issuePrefix}-1`,
      });

      const comment1 = await db.insert(issueComments).values({
        companyId, issueId, authorUserId: "u1", body: "Start",
      }).returning().then((r) => r[0]);
      const firstRun = await heartbeat.wakeup(agentId, {
        source: "automation", triggerDetail: "system", reason: "issue_commented",
        payload: { issueId, commentId: comment1.id },
        contextSnapshot: { issueId, taskId: issueId, wakeReason: "issue_commented" },
        requestedByActorType: "user", requestedByActorId: "u1",
      });
      expect(firstRun).not.toBeNull();

      // Wait for first gateway agent call
      await waitFor(() => gateway.getAgentPayloads().length === 1, 15_000);

      // Queue a deferred wake
      const comment2 = await db.insert(issueComments).values({
        companyId, issueId, authorUserId: "u1", body: "Follow-up",
      }).returning().then((r) => r[0]);
      await heartbeat.wakeup(agentId, {
        source: "automation", triggerDetail: "system", reason: "issue_commented",
        payload: { issueId, commentId: comment2.id },
        contextSnapshot: { issueId, taskId: issueId, wakeReason: "issue_commented" },
        requestedByActorType: "user", requestedByActorId: "u1",
      });

      await waitFor(async () => {
        const deferred = await db.select().from(agentWakeupRequests)
          .where(eq(agentWakeupRequests.agentId, agentId))
          .then((rows) => rows.find((r) => r.status === "deferred_issue_execution") ?? null);
        return Boolean(deferred);
      });

      // Close issue AND pause agent before releasing
      await db.update(issues).set({
        status: "done", completedAt: new Date(),
        executionRunId: null, updatedAt: new Date(),
      }).where(eq(issues.id, issueId));

      // Pause the agent so the deferred wake can't be promoted
      await db.update(agents).set({ status: "paused", updatedAt: new Date() })
        .where(eq(agents.id, agentId));

      gateway.releaseFirstWait();

      // Give time for promotion attempt to run (first run must complete first)
      await waitFor(async () => {
        const run = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns)
          .where(eq(heartbeatRuns.id, firstRun!.id)).then((r) => r[0] ?? null);
        return run?.status === "succeeded" || run?.status === "failed";
      }, 30_000);
      // Additional buffer for releaseIssueExecutionAndPromote to complete
      await new Promise((r) => setTimeout(r, 500));

      // Issue should remain "done" — paused agent must not trigger reopen
      const issueFinal = await db.select({ status: issues.status, completedAt: issues.completedAt })
        .from(issues).where(eq(issues.id, issueId)).then((r) => r[0] ?? null);
      expect(issueFinal?.status).toBe("done");
      expect(issueFinal?.completedAt).not.toBeNull();

      // Only one gateway payload should have been sent (no second run)
      expect(gateway.getAgentPayloads().length).toBe(1);
    } finally {
      gateway.releaseFirstWait();
      await gateway.close();
    }
  }, 120_000);
});
