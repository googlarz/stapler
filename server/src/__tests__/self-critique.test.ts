/**
 * Unit tests for the self-critique gate service (Pillar 2 of the Quality Flywheel).
 *
 * Mocks judgeOutput to keep tests fast and side-effect-free.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockJudgeOutput = vi.hoisted(() => vi.fn(async () => ({ score: 0.8, reasoning: "looks good" })));

vi.mock("../services/eval-judge.js", () => ({
  judgeOutput: mockJudgeOutput,
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("selfCritiqueRun", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockJudgeOutput.mockResolvedValue({ score: 0.8, reasoning: "output is complete" });
  });

  it("returns passed=true when judge score >= 0.5", async () => {
    const { selfCritiqueRun } = await import("../services/self-critique.js");
    mockJudgeOutput.mockResolvedValue({ score: 0.7, reasoning: "solid work" });

    const result = await selfCritiqueRun("agent completed the task");
    expect(result.score).toBe(0.7);
    expect(result.reasoning).toBe("solid work");
    expect(result.passed).toBe(true);
  });

  it("returns passed=false when judge score < 0.5", async () => {
    const { selfCritiqueRun } = await import("../services/self-critique.js");
    mockJudgeOutput.mockResolvedValue({ score: 0.3, reasoning: "incomplete output" });

    const result = await selfCritiqueRun("agent did not finish");
    expect(result.score).toBe(0.3);
    expect(result.passed).toBe(false);
  });

  it("returns passed=false when score is exactly 0.5 boundary (exclusive)", async () => {
    const { selfCritiqueRun } = await import("../services/self-critique.js");
    mockJudgeOutput.mockResolvedValue({ score: 0.49, reasoning: "marginal" });

    const result = await selfCritiqueRun("partial work");
    expect(result.passed).toBe(false);
  });

  it("returns passed=true when score is exactly 0.5 (inclusive lower bound)", async () => {
    const { selfCritiqueRun } = await import("../services/self-critique.js");
    mockJudgeOutput.mockResolvedValue({ score: 0.5, reasoning: "borderline" });

    const result = await selfCritiqueRun("borderline output");
    expect(result.passed).toBe(true);
  });

  it("passes the excerpt to judgeOutput", async () => {
    const { selfCritiqueRun } = await import("../services/self-critique.js");
    const excerpt = "specific output content for grading";

    await selfCritiqueRun(excerpt);

    expect(mockJudgeOutput).toHaveBeenCalledOnce();
    // Second argument to judgeOutput should be the excerpt
    expect(mockJudgeOutput).toHaveBeenCalledWith(expect.any(String), excerpt);
  });

  it("includes reasoning in the result", async () => {
    const { selfCritiqueRun } = await import("../services/self-critique.js");
    mockJudgeOutput.mockResolvedValue({ score: 0.9, reasoning: "excellent, task fully completed" });

    const result = await selfCritiqueRun("wrote all required files");
    expect(result.reasoning).toBe("excellent, task fully completed");
  });
});

describe("maybeSelfCritique", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockJudgeOutput.mockResolvedValue({ score: 0.8, reasoning: "good" });
  });

  it("returns succeeded when agent has no selfCritiqueThreshold set", async () => {
    const { maybeSelfCritique } = await import("../services/self-critique.js");
    const agent = { id: "agent-1", selfCritiqueThreshold: null } as any;

    const result = await maybeSelfCritique(agent, "some output");
    expect(result.status).toBe("succeeded");
    expect(mockJudgeOutput).not.toHaveBeenCalled();
  });

  it("returns succeeded when selfCritiqueThreshold is 0 (every score passes)", async () => {
    const { maybeSelfCritique } = await import("../services/self-critique.js");
    const agent = { id: "agent-1", selfCritiqueThreshold: 0 } as any;
    mockJudgeOutput.mockResolvedValue({ score: 0.0, reasoning: "minimal" });

    const result = await maybeSelfCritique(agent, "some output");
    // score (0.0) >= threshold (0) → passes
    expect(result.status).toBe("succeeded");
  });

  it("returns succeeded when stdoutExcerpt is empty (skip critique)", async () => {
    const { maybeSelfCritique } = await import("../services/self-critique.js");
    const agent = { id: "agent-1", selfCritiqueThreshold: 0.6 } as any;

    const result = await maybeSelfCritique(agent, "");
    expect(result.status).toBe("succeeded");
    expect(mockJudgeOutput).not.toHaveBeenCalled();
  });

  it("returns succeeded when score >= threshold", async () => {
    const { maybeSelfCritique } = await import("../services/self-critique.js");
    const agent = { id: "agent-1", selfCritiqueThreshold: 0.6, adapterConfig: {} } as any;
    mockJudgeOutput.mockResolvedValue({ score: 0.85, reasoning: "passed" });

    const result = await maybeSelfCritique(agent, "completed all tasks");
    expect(result.status).toBe("succeeded");
    expect(result.critique?.score).toBe(0.85);
  });

  it("returns needs_review when score < threshold", async () => {
    const { maybeSelfCritique } = await import("../services/self-critique.js");
    const agent = { id: "agent-1", selfCritiqueThreshold: 0.6, adapterConfig: {} } as any;
    mockJudgeOutput.mockResolvedValue({ score: 0.3, reasoning: "incomplete" });

    const result = await maybeSelfCritique(agent, "partial output only");
    expect(result.status).toBe("needs_review");
    expect(result.critique?.score).toBe(0.3);
  });

  it("threshold of 0.6: score 0.6 passes (boundary inclusive)", async () => {
    const { maybeSelfCritique } = await import("../services/self-critique.js");
    const agent = { id: "agent-1", selfCritiqueThreshold: 0.6 } as any;
    mockJudgeOutput.mockResolvedValue({ score: 0.6, reasoning: "borderline" });

    const result = await maybeSelfCritique(agent, "just enough output");
    expect(result.status).toBe("succeeded");
  });

  it("threshold of 0.6: score 0.59 fails", async () => {
    const { maybeSelfCritique } = await import("../services/self-critique.js");
    const agent = { id: "agent-1", selfCritiqueThreshold: 0.6 } as any;
    mockJudgeOutput.mockResolvedValue({ score: 0.59, reasoning: "just below" });

    const result = await maybeSelfCritique(agent, "barely-there output");
    expect(result.status).toBe("needs_review");
  });
});
