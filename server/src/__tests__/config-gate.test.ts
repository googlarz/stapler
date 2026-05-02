/**
 * Unit tests for the config-change gate service (Pillar 4 of the Quality Flywheel).
 *
 * Mocks runEvalSuite and the DB to stay fast and side-effect-free.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockRunEvalSuite = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../services/eval-runner.js", () => ({
  runEvalSuite: mockRunEvalSuite,
}));

// ── DB factory ────────────────────────────────────────────────────────────────

interface DbOpts {
  suiteRows?: unknown[];
  baselineRows?: unknown[];
  insertResult?: unknown[];
  finishedRunRows?: unknown[];
}

function makeDb(opts: DbOpts = {}) {
  const {
    suiteRows = [{ id: "suite-1", name: "smoke" }],
    baselineRows = [],
    insertResult = [{ id: "eval-run-1" }],
    finishedRunRows = [],
  } = opts;

  let selectCallCount = 0;

  return {
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          orderBy: (_ord: unknown) => ({
            limit: () => {
              selectCallCount++;
              // Call 1: load suite, Call 2: baseline run, Call 3+: finished run
              if (selectCallCount === 1) return Promise.resolve(suiteRows);
              if (selectCallCount === 2) return Promise.resolve(baselineRows);
              return Promise.resolve(finishedRunRows);
            },
          }),
          limit: () => {
            selectCallCount++;
            if (selectCallCount === 1) return Promise.resolve(suiteRows);
            if (selectCallCount === 2) return Promise.resolve(baselineRows);
            return Promise.resolve(finishedRunRows);
          },
        }),
      }),
    }),
    insert: (_table: unknown) => ({
      values: (_vals: unknown) => ({
        returning: () => Promise.resolve(insertResult),
      }),
    }),
    update: (_table: unknown) => ({
      set: (_vals: unknown) => ({
        where: (_cond: unknown) => Promise.resolve([]),
      }),
    }),
  } as any;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent-1",
    smokeSuiteId: "suite-1",
    smokeRegressionTolerance: null,
    adapterType: "claude_local",
    adapterConfig: { systemPrompt: "old prompt" },
    runtimeConfig: {},
    ...overrides,
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GATED_KEYS", () => {
  it("includes expected keys", async () => {
    const { GATED_KEYS } = await import("../services/config-gate.js");
    expect(GATED_KEYS.has("systemPrompt")).toBe(true);
    expect(GATED_KEYS.has("model")).toBe(true);
    expect(GATED_KEYS.has("adapterType")).toBe(true);
    expect(GATED_KEYS.has("mcpServers")).toBe(true);
    expect(GATED_KEYS.has("tools")).toBe(true);
    expect(GATED_KEYS.has("irrelevantKey")).toBe(false);
  });
});

describe("runConfigGate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRunEvalSuite.mockResolvedValue(undefined);
  });

  it("returns null when agent has no smokeSuiteId", async () => {
    const { runConfigGate } = await import("../services/config-gate.js");
    const agent = makeAgent({ smokeSuiteId: null });
    const db = makeDb();

    const result = await runConfigGate(db, agent, ["systemPrompt"]);
    expect(result).toBeNull();
    expect(mockRunEvalSuite).not.toHaveBeenCalled();
  });

  it("returns null when no gated keys changed", async () => {
    const { runConfigGate } = await import("../services/config-gate.js");
    const agent = makeAgent();
    const db = makeDb();

    const result = await runConfigGate(db, agent, ["description", "name"]);
    expect(result).toBeNull();
    expect(mockRunEvalSuite).not.toHaveBeenCalled();
  });

  it("returns null when suite no longer exists (deleted)", async () => {
    const { runConfigGate } = await import("../services/config-gate.js");
    const agent = makeAgent();
    const db = makeDb({ suiteRows: [] });

    const result = await runConfigGate(db, agent, ["systemPrompt"]);
    expect(result).toBeNull();
  });

  it("returns null when eval run insert fails (no row returned)", async () => {
    const { runConfigGate } = await import("../services/config-gate.js");
    const agent = makeAgent();
    const db = makeDb({ insertResult: [] });

    const result = await runConfigGate(db, agent, ["systemPrompt"]);
    expect(result).toBeNull();
  });

  it("returns passed=true with score=0 when finished run has no score (lenient)", async () => {
    const { runConfigGate } = await import("../services/config-gate.js");
    const agent = makeAgent();
    // finishedRunRows with null avgScore
    const db = makeDb({ finishedRunRows: [{ summaryJson: { avgScore: null } }] });

    const result = await runConfigGate(db, agent, ["systemPrompt"]);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
    expect(result!.score).toBe(0);
  });

  it("returns passed=true with score when no baseline (first run ever)", async () => {
    const { runConfigGate } = await import("../services/config-gate.js");
    const agent = makeAgent();
    const db = makeDb({
      baselineRows: [],
      finishedRunRows: [{ summaryJson: { avgScore: 0.75 } }],
    });

    const result = await runConfigGate(db, agent, ["model"]);
    expect(result!.passed).toBe(true);
    expect(result!.score).toBe(0.75);
  });

  it("passes when score is within tolerance of baseline", async () => {
    const { runConfigGate } = await import("../services/config-gate.js");
    const agent = makeAgent({ smokeRegressionTolerance: 0.1 });
    const db = makeDb({
      baselineRows: [{ summaryJson: { avgScore: 0.8 } }],
      finishedRunRows: [{ summaryJson: { avgScore: 0.72 } }],
    });

    // baseline=0.8, tolerance=0.1, floor=0.7 → score 0.72 >= 0.7 → pass
    const result = await runConfigGate(db, agent, ["systemPrompt"]);
    expect(result!.passed).toBe(true);
  });

  it("fails when score drops below floor (baseline - tolerance)", async () => {
    const { runConfigGate } = await import("../services/config-gate.js");
    const agent = makeAgent({ smokeRegressionTolerance: 0.1 });
    const db = makeDb({
      baselineRows: [{ summaryJson: { avgScore: 0.8 } }],
      finishedRunRows: [{ summaryJson: { avgScore: 0.65 } }],
    });

    // baseline=0.8, tolerance=0.1, floor=0.7 → score 0.65 < 0.7 → fail
    const result = await runConfigGate(db, agent, ["systemPrompt"]);
    expect(result!.passed).toBe(false);
    expect((result as { passed: false; message: string }).message).toContain("regressed");
  });

  it("calls runEvalSuite with the new eval run id", async () => {
    const { runConfigGate } = await import("../services/config-gate.js");
    const agent = makeAgent();
    const db = makeDb({
      finishedRunRows: [{ summaryJson: { avgScore: 0.9 } }],
    });

    await runConfigGate(db, agent, ["systemPrompt"]);
    expect(mockRunEvalSuite).toHaveBeenCalledWith(expect.anything(), "eval-run-1");
  });
});
