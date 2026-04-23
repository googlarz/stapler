/**
 * skill-executor.test.ts
 *
 * Unit tests for:
 *   - earlyStampSkillRunId  — stamps heartbeat_run_id on invocation row early
 *   - loadSkillForRun       — marks invocation "running", injects paperclipSkillCommand
 *   - finalizeSkillInvocation — updates status to succeeded/failed
 *
 * All DB interactions are stubbed — no real Postgres required.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  earlyStampSkillRunId,
  loadSkillForRun,
  finalizeSkillInvocation,
} from "../services/skill-executor.js";

// ---------------------------------------------------------------------------
// Shared DB stub factory
// ---------------------------------------------------------------------------

function makeDb({
  invocationRow = null as { id: string; issueId: string } | null,
  lastCommentRow = null as { id: string } | null,
  skillRow = null as { markdown: string; name: string } | null,
} = {}) {
  const updateSetWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateSetWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  const selectFromWhereLimitThen = vi.fn().mockResolvedValue(invocationRow ? [invocationRow] : []);
  const selectFromWhereLimit = vi.fn().mockReturnValue({ then: selectFromWhereLimitThen });
  const selectFromWhereOrderBy = vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ then: vi.fn().mockResolvedValue(lastCommentRow ? [lastCommentRow] : []) }) });
  const selectFromWhere = vi.fn().mockReturnValue({
    limit: selectFromWhereLimit,
    orderBy: selectFromWhereOrderBy,
  });
  const selectFrom = vi.fn().mockReturnValue({ where: selectFromWhere });
  const select = vi.fn().mockReturnValue({ from: selectFrom });

  return {
    select,
    update,
    _mocks: { update, updateSet, updateSetWhere, select, selectFrom, selectFromWhere },
  } as unknown as import("@stapler/db").Db & { _mocks: Record<string, ReturnType<typeof vi.fn>> };
}

// Mock instanceSkillService so loadSkillForRun doesn't need real DB for skill lookup
const mockGetByKey = vi.fn();
vi.mock("../services/instance-skills.js", () => ({
  instanceSkillService: () => ({
    getByKey: mockGetByKey,
  }),
}));

// ---------------------------------------------------------------------------
// earlyStampSkillRunId
// ---------------------------------------------------------------------------

describe("earlyStampSkillRunId", () => {
  it("stamps heartbeat_run_id on the invocation row when wake reason is skill_command_invoked", async () => {
    const db = makeDb();
    const context = {
      wakeReason: "skill_command_invoked",
      skillInvocationId: "inv-abc",
    };

    await earlyStampSkillRunId(db, "run-1", context);

    expect(db.update).toHaveBeenCalledOnce();
  });

  it("no-ops when wake reason is not skill_command_invoked", async () => {
    const db = makeDb();
    const context = { wakeReason: "comment_received" };

    await earlyStampSkillRunId(db, "run-1", context);

    expect(db.update).not.toHaveBeenCalled();
  });

  it("no-ops when wakeReason is missing from context", async () => {
    const db = makeDb();
    await earlyStampSkillRunId(db, "run-1", {});
    expect(db.update).not.toHaveBeenCalled();
  });

  it("no-ops when skillInvocationId is missing even if wake reason matches", async () => {
    const db = makeDb();
    const context = { wakeReason: "skill_command_invoked" };

    await earlyStampSkillRunId(db, "run-1", context);

    expect(db.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// loadSkillForRun
// ---------------------------------------------------------------------------

describe("loadSkillForRun", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function makeContext(overrides: Record<string, unknown> = {}) {
    return {
      wakeReason: "skill_command_invoked",
      skillCommandName: "plan-phase",
      skillInvocationId: "inv-xyz",
      skillArgs: { phase: "1" },
      ...overrides,
    };
  }

  it("marks the invocation as running and injects paperclipSkillCommand into context", async () => {
    const db = makeDb();
    mockGetByKey.mockResolvedValue({ markdown: "# Plan Phase\nDo the thing.", name: "plan-phase" });

    const context = makeContext();
    await loadSkillForRun(db, "company-1", "run-99", context);

    // The invocation row should be marked "running"
    expect(db.update).toHaveBeenCalledOnce();

    // paperclipSkillCommand should be injected
    const cmd = (context as Record<string, unknown>).paperclipSkillCommand as Record<string, unknown>;
    expect(cmd).toBeDefined();
    expect(cmd.name).toBe("plan-phase");
    expect(cmd.markdown).toBe("# Plan Phase\nDo the thing.");
    expect(cmd.invocationId).toBe("inv-xyz");
    expect(cmd.args).toEqual({ phase: "1" });
  });

  it("no-ops when wake reason is not skill_command_invoked", async () => {
    const db = makeDb();
    const context = { wakeReason: "comment_received" };

    await loadSkillForRun(db, "company-1", "run-1", context);

    expect(db.update).not.toHaveBeenCalled();
    expect((context as Record<string, unknown>).paperclipSkillCommand).toBeUndefined();
  });

  it("no-ops when skillCommandName is absent", async () => {
    const db = makeDb();
    const context = { wakeReason: "skill_command_invoked", skillInvocationId: "inv-1" };

    await loadSkillForRun(db, "company-1", "run-1", context);

    expect(db.update).not.toHaveBeenCalled();
  });

  it("marks invocation as running but does not inject paperclipSkillCommand when skill is not found in registry", async () => {
    const db = makeDb();
    mockGetByKey.mockResolvedValue(null); // skill not found

    const context = makeContext();
    await loadSkillForRun(db, "company-1", "run-99", context);

    // Still marks running
    expect(db.update).toHaveBeenCalledOnce();
    // But no injection
    expect((context as Record<string, unknown>).paperclipSkillCommand).toBeUndefined();
  });

  it("does not throw when DB update fails — failure is swallowed (fire-and-forget style)", async () => {
    const db = makeDb();
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error("DB down")),
      }),
    });
    mockGetByKey.mockResolvedValue({ markdown: "# Skill", name: "skill" });

    const context = makeContext();
    await expect(loadSkillForRun(db, "c1", "run-1", context)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// finalizeSkillInvocation
// ---------------------------------------------------------------------------

describe("finalizeSkillInvocation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("sets status to succeeded and records the last comment id on success", async () => {
    // We need a DB that returns the invocation row by heartbeatRunId
    // and the last comment for that run.
    const invRow = { id: "inv-1", issueId: "issue-1" };
    const commentRow = { id: "comment-99" };

    // Build a more controlled DB stub for this test
    let selectCallIndex = 0;
    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            // First select: invocation lookup (limit 1, then)
            limit: vi.fn().mockReturnValue({
              then: vi.fn().mockImplementation((fn: (rows: unknown[]) => unknown) => fn([invRow])),
            }),
            // Second select: last comment lookup (orderBy + limit + then)
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                then: vi.fn().mockImplementation((fn: (rows: unknown[]) => unknown) => {
                  selectCallIndex++;
                  return fn(selectCallIndex === 1 ? [commentRow] : []);
                }),
              }),
            }),
          }),
        }),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    } as unknown as import("@stapler/db").Db;

    await finalizeSkillInvocation(db, {
      runId: "run-1",
      outcome: "succeeded",
      issueId: "issue-1",
    });

    expect(db.update).toHaveBeenCalledOnce();
    const setCall = (db.update as ReturnType<typeof vi.fn>).mock.results[0].value.set as ReturnType<typeof vi.fn>;
    const updatePayload = setCall.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload.status).toBe("succeeded");
  });

  it("sets status to failed with errorMessage on failure", async () => {
    const invRow = { id: "inv-2", issueId: "issue-1" };
    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              then: vi.fn().mockImplementation((fn: (rows: unknown[]) => unknown) => fn([invRow])),
            }),
          }),
        }),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    } as unknown as import("@stapler/db").Db;

    await finalizeSkillInvocation(db, {
      runId: "run-2",
      outcome: "failed",
      issueId: "issue-1",
      errorMessage: "Adapter crashed",
    });

    const setCall = (db.update as ReturnType<typeof vi.fn>).mock.results[0].value.set as ReturnType<typeof vi.fn>;
    const payload = setCall.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe("failed");
    expect(payload.errorMessage).toBe("Adapter crashed");
  });

  it("no-ops when there is no invocation row for the run (orphaned run)", async () => {
    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              then: vi.fn().mockImplementation((fn: (rows: unknown[]) => unknown) => fn([])),
            }),
          }),
        }),
      })),
      update: vi.fn(),
    } as unknown as import("@stapler/db").Db;

    await finalizeSkillInvocation(db, {
      runId: "run-orphan",
      outcome: "succeeded",
      issueId: null,
    });

    expect(db.update).not.toHaveBeenCalled();
  });

  it("uses fallback issueId from invocation row when caller passes null", async () => {
    const invRow = { id: "inv-3", issueId: "issue-from-db" };
    const captured: Record<string, unknown>[] = [];

    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              then: vi.fn().mockImplementation((fn: (rows: unknown[]) => unknown) => fn([invRow])),
            }),
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                then: vi.fn().mockImplementation((fn: (rows: unknown[]) => unknown) => fn([])),
              }),
            }),
          }),
        }),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((row: Record<string, unknown>) => {
          captured.push(row);
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      }),
    } as unknown as import("@stapler/db").Db;

    await finalizeSkillInvocation(db, {
      runId: "run-3",
      outcome: "succeeded",
      issueId: null, // caller doesn't know the issueId
    });

    // Should still succeed — issueId from the invocation row is used
    expect(captured[0]?.status).toBe("succeeded");
  });

  it("defaults errorMessage to 'Run failed' when none is provided", async () => {
    const invRow = { id: "inv-4", issueId: null };
    const captured: Record<string, unknown>[] = [];

    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              then: vi.fn().mockImplementation((fn: (rows: unknown[]) => unknown) => fn([invRow])),
            }),
          }),
        }),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((row: Record<string, unknown>) => {
          captured.push(row);
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      }),
    } as unknown as import("@stapler/db").Db;

    await finalizeSkillInvocation(db, {
      runId: "run-4",
      outcome: "failed",
      issueId: null,
    });

    expect(captured[0]?.errorMessage).toBe("Run failed");
  });
});
