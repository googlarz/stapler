/**
 * Unit tests for the post-mortem pipeline (Pillar 3 of the Quality Flywheel).
 *
 * Mocks OpenAI fetch and agentMemoryService to keep tests fast.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockMemorySave = vi.hoisted(() => vi.fn(async () => ({})));
const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("../services/agent-memories.js", () => ({
  agentMemoryService: () => ({ save: mockMemorySave }),
}));

// Replace global fetch for OpenAI calls
vi.stubGlobal("fetch", mockFetch);

// ── DB factory ────────────────────────────────────────────────────────────────

function makeDb(runRow?: {
  agentId?: string;
  companyId?: string;
  stdoutExcerpt?: string;
}) {
  const row = runRow ?? null;
  return {
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: () => Promise.resolve(row ? [row] : []),
        }),
      }),
    }),
  } as any;
}

// ── Tests: maybeRunPostMortemOnLowScore ───────────────────────────────────────

describe("maybeRunPostMortemOnLowScore", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("does nothing when score >= threshold", async () => {
    const { maybeRunPostMortemOnLowScore } = await import("../services/post-mortem.js");
    const db = makeDb();

    await maybeRunPostMortemOnLowScore(db, "run-1", 0.6, 0.5);
    // DB should not be queried since we bail early
    expect(mockMemorySave).not.toHaveBeenCalled();
  });

  it("does nothing when score equals threshold (exclusive)", async () => {
    const { maybeRunPostMortemOnLowScore } = await import("../services/post-mortem.js");
    const db = makeDb();

    await maybeRunPostMortemOnLowScore(db, "run-1", 0.5, 0.5);
    expect(mockMemorySave).not.toHaveBeenCalled();
  });

  it("triggers runPostMortem when score < threshold (run not found → no memory write)", async () => {
    const { maybeRunPostMortemOnLowScore } = await import("../services/post-mortem.js");
    // run not found → runPostMortem returns early, no memory save
    const db = makeDb(undefined);

    await maybeRunPostMortemOnLowScore(db, "run-1", 0.3, 0.5);
    expect(mockMemorySave).not.toHaveBeenCalled(); // no run found
  });
});

// ── Tests: runPostMortem ──────────────────────────────────────────────────────

describe("runPostMortem", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: OPENAI_API_KEY not set → OpenAI branch skipped; Ollama also mocked to fail
    delete process.env.OPENAI_API_KEY;
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });
  });

  it("returns early when run has no stdoutExcerpt", async () => {
    const { runPostMortem } = await import("../services/post-mortem.js");
    const db = makeDb({ agentId: "agent-1", companyId: "co-1", stdoutExcerpt: undefined });

    await runPostMortem(db, "run-1", null);
    expect(mockMemorySave).not.toHaveBeenCalled();
  });

  it("returns early when stdoutExcerpt is too short (< 20 chars)", async () => {
    const { runPostMortem } = await import("../services/post-mortem.js");
    const db = makeDb({ agentId: "agent-1", companyId: "co-1", stdoutExcerpt: "short" });

    await runPostMortem(db, "run-1", null);
    expect(mockMemorySave).not.toHaveBeenCalled();
  });

  it("returns early when extraction fails (no OpenAI key + Ollama down)", async () => {
    const { runPostMortem } = await import("../services/post-mortem.js");
    const db = makeDb({
      agentId: "agent-1",
      companyId: "co-1",
      stdoutExcerpt: "agent attempted to fix the bug but the tests still fail",
    });

    await runPostMortem(db, "run-1", null);
    // extraction returns null → rule not written → no memory save
    expect(mockMemorySave).not.toHaveBeenCalled();
  });

  it("saves a memory with [Rule] prefix when extraction succeeds via OpenAI", async () => {
    const { runPostMortem } = await import("../services/post-mortem.js");
    process.env.OPENAI_API_KEY = "sk-test";

    const ruleJson = JSON.stringify({
      diagnosis: "skipped validation",
      rule: "Always run tests before marking done",
      appliesWhen: "when modifying production code",
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: ruleJson } }],
      }),
    });

    const db = makeDb({
      agentId: "agent-1",
      companyId: "co-1",
      stdoutExcerpt: "modified auth.ts without running the test suite first",
    });

    await runPostMortem(db, "run-1", null);
    expect(mockMemorySave).toHaveBeenCalledOnce();
    const savedContent = mockMemorySave.mock.calls[0]![0].content as string;
    expect(savedContent).toContain("[Rule]");
    expect(savedContent).toContain("Always run tests before marking done");
  });

  it("includes feedbackReason in LLM call when provided", async () => {
    const { runPostMortem } = await import("../services/post-mortem.js");
    process.env.OPENAI_API_KEY = "sk-test";

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ diagnosis: "d", rule: "r", appliesWhen: "a" }) } }],
      }),
    });

    const db = makeDb({
      agentId: "agent-1",
      companyId: "co-1",
      stdoutExcerpt: "agent failed to handle the edge case in user registration",
    });

    await runPostMortem(db, "run-1", "missed input validation");

    const fetchCall = mockFetch.mock.calls[0]!;
    const body = JSON.parse(fetchCall[1].body as string);
    const userContent = body.messages.find((m: { role: string }) => m.role === "user")?.content ?? "";
    expect(userContent).toContain("missed input validation");
  });
});
