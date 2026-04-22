/**
 * Route-level tests for quality flywheel routes.
 * DB is mocked with a chainable Drizzle-style mock; services are mocked via vi.mock.
 */

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockRunPostMortem = vi.hoisted(() => vi.fn(async () => {}));
const mockGetAgentQualityTrends = vi.hoisted(() => vi.fn(async () => ({ windows: [] })));
const mockGetAgentCollabStats = vi.hoisted(() => vi.fn(async () => []));
const mockMinePlaybooksForAgent = vi.hoisted(() => vi.fn(async () => 3));

vi.mock("../services/post-mortem.js", () => ({
  runPostMortem: mockRunPostMortem,
  maybeRunPostMortemOnLowScore: vi.fn(async () => {}),
}));

vi.mock("../services/quality-trends.js", () => ({
  getAgentQualityTrends: mockGetAgentQualityTrends,
  checkDrift: vi.fn(async () => {}),
}));

vi.mock("../services/collaboration-analyzer.js", () => ({
  getAgentCollabStats: mockGetAgentCollabStats,
}));

vi.mock("../services/playbook-miner.js", () => ({
  minePlaybooksForAgent: mockMinePlaybooksForAgent,
}));

vi.mock("@stapler/shared/telemetry", () => ({
  trackAgentTaskCompleted: vi.fn(),
  trackErrorHandlerCrash: vi.fn(),
}));

vi.mock("../telemetry.js", () => ({
  getTelemetryClient: vi.fn(() => null),
}));

// ── Chainable DB mock factory ─────────────────────────────────────────────────

type ChainResult = Record<string, unknown>[];

function makeChain(result: ChainResult) {
  const chain: Record<string, unknown> = {};
  const terminal = () => Promise.resolve(result);
  const self = () => chain;
  chain.from = self;
  chain.where = self;
  chain.innerJoin = self;
  chain.groupBy = terminal;
  chain.limit = terminal;
  // orderBy is terminal when no limit follows, but also chainable when limit follows.
  // Make it return a thenable chain so both patterns work.
  const orderByChain = {
    ...chain,
    then: (resolve: (v: ChainResult) => void) => resolve(result),
    limit: terminal,
  };
  chain.orderBy = () => orderByChain;
  chain.values = () => ({ returning: () => Promise.resolve(result) });
  chain.set = () => ({ where: () => ({ returning: () => Promise.resolve(result) }) });
  return chain;
}

function makeDb(opts: {
  selectResult?: ChainResult;
  insertResult?: ChainResult;
  updateResult?: ChainResult;
  deleteResult?: ChainResult;
} = {}) {
  return {
    select: (_fields?: unknown) => makeChain(opts.selectResult ?? []),
    insert: (_table: unknown) => ({
      values: (_vals: unknown) => ({
        returning: () => Promise.resolve(opts.insertResult ?? []),
      }),
    }),
    update: (_table: unknown) => ({
      set: (_vals: unknown) => ({
        where: (_cond: unknown) => ({
          returning: () => Promise.resolve(opts.updateResult ?? []),
        }),
      }),
    }),
    delete: (_table: unknown) => ({
      where: (_cond: unknown) => Promise.resolve(opts.deleteResult ?? []),
    }),
  };
}

// ── App factory ───────────────────────────────────────────────────────────────

async function createApp(
  actor: Record<string, unknown>,
  db: ReturnType<typeof makeDb>,
) {
  const [{ qualityRoutes }, { errorHandler }] = await Promise.all([
    import("../routes/quality.js"),
    import("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", qualityRoutes(db as any));
  app.use(errorHandler);
  return app;
}

const boardActor = {
  type: "board",
  userId: "user-1",
  source: "session",
  isInstanceAdmin: false,
  companyIds: ["company-1"],
};

const agentActor = {
  type: "agent",
  agentId: "agent-1",
  companyId: "company-1",
  source: "agent_key",
  runId: "run-1",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /runs/:id/score", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it("returns 404 when no score exists", async () => {
    const db = makeDb({ selectResult: [] });
    const app = await createApp(boardActor, db);
    const res = await request(app).get("/api/runs/run-1/score");
    expect(res.status).toBe(404);
  });

  it("returns score when found and company access matches", async () => {
    const db = makeDb({
      selectResult: [{ id: "score-1", runId: "run-1", companyId: "company-1", score: 0.8 }],
    });
    const app = await createApp(boardActor, db);
    const res = await request(app).get("/api/runs/run-1/score");
    expect(res.status).toBe(200);
    expect(res.body.score).toBe(0.8);
  });

  it("returns 403 when actor lacks company access", async () => {
    const db = makeDb({
      selectResult: [{ id: "score-1", runId: "run-1", companyId: "company-2", score: 0.8 }],
    });
    const app = await createApp(boardActor, db);
    const res = await request(app).get("/api/runs/run-1/score");
    expect(res.status).toBe(403);
  });
});

describe("GET /agents/:id/quality/trend", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it("returns 404 for unknown agent", async () => {
    const db = makeDb({ selectResult: [] });
    const app = await createApp(boardActor, db);
    const res = await request(app).get("/api/agents/unknown/quality/trend");
    expect(res.status).toBe(404);
  });

  it("returns trend data for known agent", async () => {
    // Need select to return different values for agent query vs score queries
    let callCount = 0;
    const db = {
      ...makeDb(),
      select: (_fields?: unknown) => {
        callCount++;
        if (callCount === 1) {
          return makeChain([{ id: "agent-1", companyId: "company-1" }]);
        }
        if (callCount === 2) {
          // summary
          return makeChain([{ avgScore: 0.75, sampleSize: 5 }]);
        }
        // recent
        return makeChain([{ id: "score-1", runId: "run-1", score: 0.9, judgedAt: new Date() }]);
      },
    };
    const app = await createApp(boardActor, db as any);
    const res = await request(app).get("/api/agents/agent-1/quality/trend");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("windowDays", 30);
    expect(res.body).toHaveProperty("recent");
  });
});

describe("GET /agents/:id/quality/trends", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it("delegates to getAgentQualityTrends and returns result", async () => {
    const trendData = { windows: [{ days: 7, avgScore: 0.8 }] };
    mockGetAgentQualityTrends.mockResolvedValueOnce(trendData);
    const db = makeDb({
      selectResult: [{ id: "agent-1", companyId: "company-1" }],
    });
    const app = await createApp(boardActor, db);
    const res = await request(app).get("/api/agents/agent-1/quality/trends");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(trendData);
    expect(mockGetAgentQualityTrends).toHaveBeenCalled();
  });
});

describe("GET /companies/:companyId/quality/trend", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it("returns 403 when actor lacks company access", async () => {
    const db = makeDb();
    const app = await createApp(boardActor, db);
    const res = await request(app).get("/api/companies/company-99/quality/trend");
    expect(res.status).toBe(403);
  });

  it("returns items for authorized company", async () => {
    const db = makeDb({
      selectResult: [{ agentId: "agent-1", avgScore: 0.9, sampleSize: 3 }],
    });
    const app = await createApp(boardActor, db);
    const res = await request(app).get("/api/companies/company-1/quality/trend");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
  });
});

describe("GET /companies/:companyId/quality/recent", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it("returns recent scores", async () => {
    const db = makeDb({
      selectResult: [{ id: "score-1", runId: "run-1", agentId: "agent-1", score: 0.7 }],
    });
    const app = await createApp(boardActor, db);
    const res = await request(app).get("/api/companies/company-1/quality/recent");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

describe("POST /runs/:id/post-mortem", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it("returns 202 and fires runPostMortem async", async () => {
    // First select returns a score row with companyId
    const db = makeDb({
      selectResult: [{ companyId: "company-1" }],
    });
    const app = await createApp(boardActor, db);
    const res = await request(app).post("/api/runs/run-1/post-mortem").send({ reason: "too slow" });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("post-mortem queued");
  });

  it("returns 404 when run not found", async () => {
    const db = makeDb({ selectResult: [] });
    const app = await createApp(boardActor, db);
    const res = await request(app).post("/api/runs/unknown-run/post-mortem").send({});
    expect(res.status).toBe(404);
  });
});

describe("GET /agents/:id/collab-stats", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it("delegates to getAgentCollabStats", async () => {
    const stats = [{ fromAgentId: "agent-1", toAgentId: "agent-2", totalDelegations: 5, winRate: 0.8 }];
    mockGetAgentCollabStats.mockResolvedValueOnce(stats);
    const db = makeDb({
      selectResult: [{ id: "agent-1", companyId: "company-1" }],
    });
    const app = await createApp(boardActor, db);
    const res = await request(app).get("/api/agents/agent-1/collab-stats");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual(stats);
  });
});

describe("GET /agents/:id/playbooks", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it("returns playbook list", async () => {
    let callCount = 0;
    const db = {
      ...makeDb(),
      select: (_fields?: unknown) => {
        callCount++;
        if (callCount === 1) {
          return makeChain([{ id: "agent-1", companyId: "company-1" }]);
        }
        return makeChain([{ id: "pb-1", agentId: "agent-1", title: "Deploy flow" }]);
      },
    };
    const app = await createApp(boardActor, db as any);
    const res = await request(app).get("/api/agents/agent-1/playbooks");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
  });
});

describe("POST /agents/:id/playbooks/mine", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it("requires board auth", async () => {
    const db = makeDb({ selectResult: [{ id: "agent-1", companyId: "company-1" }] });
    const app = await createApp(agentActor, db);
    const res = await request(app).post("/api/agents/agent-1/playbooks/mine");
    expect(res.status).toBe(403);
  });

  it("calls minePlaybooksForAgent and returns count", async () => {
    mockMinePlaybooksForAgent.mockResolvedValueOnce(5);
    const db = makeDb({ selectResult: [{ id: "agent-1", companyId: "company-1" }] });
    const app = await createApp(boardActor, db);
    const res = await request(app).post("/api/agents/agent-1/playbooks/mine");
    expect(res.status).toBe(200);
    expect(res.body.playbooksUpserted).toBe(5);
  });
});

describe("PATCH /agents/:agentId/playbooks/:id", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it("requires board auth", async () => {
    const db = makeDb({ selectResult: [{ id: "agent-1", companyId: "company-1" }] });
    const app = await createApp(agentActor, db);
    const res = await request(app).patch("/api/agents/agent-1/playbooks/pb-1").send({ active: false });
    expect(res.status).toBe(403);
  });

  it("updates active flag", async () => {
    const db = {
      ...makeDb(),
      select: (_fields?: unknown) => makeChain([{ id: "agent-1", companyId: "company-1" }]),
      update: (_table: unknown) => ({
        set: (_vals: unknown) => ({
          where: (_cond: unknown) => ({
            returning: () => Promise.resolve([{ id: "pb-1", active: 0 }]),
          }),
        }),
      }),
    };
    const app = await createApp(boardActor, db as any);
    const res = await request(app).patch("/api/agents/agent-1/playbooks/pb-1").send({ active: false });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(0);
  });

  it("returns 404 when playbook not found", async () => {
    const db = {
      ...makeDb(),
      select: (_fields?: unknown) => makeChain([{ id: "agent-1", companyId: "company-1" }]),
      update: (_table: unknown) => ({
        set: (_vals: unknown) => ({
          where: (_cond: unknown) => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      }),
    };
    const app = await createApp(boardActor, db as any);
    const res = await request(app).patch("/api/agents/agent-1/playbooks/nonexistent").send({ active: true });
    expect(res.status).toBe(404);
  });
});

describe("GET /companies/:companyId/playbook-experiments", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it("returns experiments for authorized company", async () => {
    const db = makeDb({
      selectResult: [{ id: "exp-1", companyId: "company-1" }],
    });
    const app = await createApp(boardActor, db);
    const res = await request(app).get("/api/companies/company-1/playbook-experiments");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});
