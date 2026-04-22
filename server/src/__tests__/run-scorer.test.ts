/**
 * Unit tests for the run-scorer service (Pillar 1 of the Quality Flywheel).
 *
 * Mocks judgeOutput and the post-mortem trigger to keep tests fast and
 * side-effect-free.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockJudgeOutput = vi.hoisted(() => vi.fn(async () => ({ score: 0.8, reasoning: "good" })));
const mockMaybeRunPostMortemOnLowScore = vi.hoisted(() => vi.fn(async () => {}));
const mockCheckDrift = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../services/eval-judge.js", () => ({
  judgeOutput: mockJudgeOutput,
}));

vi.mock("../services/post-mortem.js", () => ({
  maybeRunPostMortemOnLowScore: mockMaybeRunPostMortemOnLowScore,
  runPostMortem: vi.fn(async () => {}),
}));

vi.mock("../services/quality-trends.js", () => ({
  checkDrift: mockCheckDrift,
  getAgentQualityTrends: vi.fn(async () => ({ windows: [] })),
}));

// ── DB factory ────────────────────────────────────────────────────────────────

function makeDb(insertResult: Record<string, unknown>[] = []) {
  return {
    insert: (_table: unknown) => ({
      values: (_vals: unknown) => ({
        returning: () => Promise.resolve(insertResult),
      }),
    }),
    select: (_fields?: unknown) => ({
      from: () => ({
        where: (_cond: unknown) => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("maybeScoreRun", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockJudgeOutput.mockResolvedValue({ score: 0.8, reasoning: "good output" });
    mockMaybeRunPostMortemOnLowScore.mockResolvedValue(undefined);
    mockCheckDrift.mockResolvedValue(undefined);
  });

  it("returns null when stdoutExcerpt is empty", async () => {
    const { maybeScoreRun } = await import("../services/run-scorer.js");
    const agent = { id: "agent-1", companyId: "company-1", adapterConfig: { autoScoreRuns: true } } as any;
    const db = makeDb();

    const result = await maybeScoreRun(db, agent, "run-1", "");
    expect(result).toBeNull();
    expect(mockJudgeOutput).not.toHaveBeenCalled();
  });

  it("returns null when stdoutExcerpt is whitespace only", async () => {
    const { maybeScoreRun } = await import("../services/run-scorer.js");
    const agent = { id: "agent-1", companyId: "company-1", adapterConfig: { autoScoreRuns: true } } as any;
    const db = makeDb();

    const result = await maybeScoreRun(db, agent, "run-1", "   \n  ");
    expect(result).toBeNull();
  });

  it("returns null when autoScoreRuns is false", async () => {
    const { maybeScoreRun } = await import("../services/run-scorer.js");
    const agent = { id: "agent-1", companyId: "company-1", adapterConfig: { autoScoreRuns: false } } as any;
    const db = makeDb();

    const result = await maybeScoreRun(db, agent, "run-1", "agent produced useful output");
    expect(result).toBeNull();
    expect(mockJudgeOutput).not.toHaveBeenCalled();
  });

  it("returns null when adapterConfig is missing autoScoreRuns", async () => {
    const { maybeScoreRun } = await import("../services/run-scorer.js");
    const agent = { id: "agent-1", companyId: "company-1", adapterConfig: {} } as any;
    const db = makeDb();

    const result = await maybeScoreRun(db, agent, "run-1", "some output");
    expect(result).toBeNull();
  });

  it("calls scoreRun when autoScoreRuns=true and excerpt is present", async () => {
    const { maybeScoreRun } = await import("../services/run-scorer.js");
    const agent = { id: "agent-1", companyId: "company-1", adapterConfig: { autoScoreRuns: true } } as any;
    const scoreRow = { id: "score-1", runId: "run-1", score: 0.8 };
    const db = makeDb([scoreRow]);

    const result = await maybeScoreRun(db, agent, "run-1", "agent did good work");
    expect(mockJudgeOutput).toHaveBeenCalledOnce();
    expect(result).toEqual(scoreRow);
  });
});

describe("scoreRun", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockJudgeOutput.mockResolvedValue({ score: 0.8, reasoning: "solid" });
    mockMaybeRunPostMortemOnLowScore.mockResolvedValue(undefined);
    mockCheckDrift.mockResolvedValue(undefined);
  });

  it("calls judgeOutput and inserts the result into run_scores", async () => {
    const { scoreRun } = await import("../services/run-scorer.js");
    const scoreRow = { id: "score-1", runId: "run-1", agentId: "agent-1", score: 0.8 };
    const db = makeDb([scoreRow]);

    const result = await scoreRun(db, {
      runId: "run-1",
      agentId: "agent-1",
      companyId: "company-1",
      stdoutExcerpt: "files written, tests passed",
    });

    expect(mockJudgeOutput).toHaveBeenCalledOnce();
    expect(result).toEqual(scoreRow);
  });

  it("does NOT trigger post-mortem when score >= 0.5", async () => {
    const { scoreRun } = await import("../services/run-scorer.js");
    mockJudgeOutput.mockResolvedValue({ score: 0.7, reasoning: "decent" });
    const db = makeDb([{ id: "score-1", score: 0.7 }]);

    await scoreRun(db, {
      runId: "run-1",
      agentId: "agent-1",
      companyId: "company-1",
      stdoutExcerpt: "output",
    });

    // Give fire-and-forget a tick to settle
    await new Promise((r) => setTimeout(r, 0));
    expect(mockMaybeRunPostMortemOnLowScore).not.toHaveBeenCalled();
  });

  it("triggers maybeRunPostMortemOnLowScore fire-and-forget when score < 0.5", async () => {
    const { scoreRun } = await import("../services/run-scorer.js");
    mockJudgeOutput.mockResolvedValue({ score: 0.3, reasoning: "poor" });
    const db = makeDb([{ id: "score-1", score: 0.3 }]);

    await scoreRun(db, {
      runId: "run-1",
      agentId: "agent-1",
      companyId: "company-1",
      stdoutExcerpt: "bad output",
    });

    // Fire-and-forget — flush microtask queue
    await new Promise((r) => setTimeout(r, 0));
    expect(mockMaybeRunPostMortemOnLowScore).toHaveBeenCalledWith(db, "run-1", 0.3);
  });

  it("returns null and does not throw on judgeOutput failure", async () => {
    const { scoreRun } = await import("../services/run-scorer.js");
    mockJudgeOutput.mockRejectedValue(new Error("LLM unavailable"));
    const db = makeDb();

    const result = await scoreRun(db, {
      runId: "run-1",
      agentId: "agent-1",
      companyId: "company-1",
      stdoutExcerpt: "output",
    });

    expect(result).toBeNull();
  });
});
