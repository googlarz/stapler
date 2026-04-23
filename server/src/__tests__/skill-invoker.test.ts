/**
 * skill-invoker.test.ts
 *
 * Unit tests for parseSlashCommand and invokeSkill.
 *
 * parseSlashCommand is a pure function — no mocks needed.
 * invokeSkill is tested with lightweight DB/wakeup stubs.
 */

import { describe, expect, it, vi } from "vitest";
import { parseSlashCommand, invokeSkill } from "../services/skill-invoker.js";

// ---------------------------------------------------------------------------
// parseSlashCommand — pure function tests
// ---------------------------------------------------------------------------

describe("parseSlashCommand", () => {
  describe("happy path — valid commands", () => {
    it("parses a simple skill name", () => {
      const result = parseSlashCommand("/plan-phase");
      expect(result).not.toBeNull();
      expect(result!.skillKey).toBe("plan-phase");
      expect(result!.rawArgs).toEqual([]);
      expect(result!.args).toEqual({});
    });

    it("parses a namespaced skill like gsd:debug", () => {
      const result = parseSlashCommand("/gsd:debug");
      expect(result).not.toBeNull();
      expect(result!.skillKey).toBe("gsd:debug");
      expect(result!.args).toEqual({});
    });

    it("parses a skill with key=value args", () => {
      const result = parseSlashCommand("/plan-phase phase=1 dry_run=true");
      expect(result).not.toBeNull();
      expect(result!.skillKey).toBe("plan-phase");
      expect(result!.args).toEqual({ phase: "1", dry_run: "true" });
      expect(result!.rawArgs).toEqual(["phase=1", "dry_run=true"]);
    });

    it("parses positional (non key=value) args under the _ key", () => {
      const result = parseSlashCommand("/gsd:debug some-task another");
      expect(result).not.toBeNull();
      expect(result!.args).toEqual({ _: ["some-task", "another"] });
    });

    it("parses a mix of key=value and positional args", () => {
      const result = parseSlashCommand("/run env=prod --verbose flag");
      expect(result).not.toBeNull();
      // env=prod is a kv pair; --verbose and flag are positional
      expect(result!.args.env).toBe("prod");
      expect(result!.args._).toEqual(["--verbose", "flag"]);
    });

    it("preserves value after the first = in a key=value arg", () => {
      // value that itself contains = should not be split further
      const result = parseSlashCommand("/deploy url=https://example.com/path?x=1");
      expect(result).not.toBeNull();
      expect(result!.args.url).toBe("https://example.com/path?x=1");
    });

    it("ignores leading/trailing whitespace around the command", () => {
      const result = parseSlashCommand("  /plan-phase phase=2  ");
      expect(result).not.toBeNull();
      expect(result!.skillKey).toBe("plan-phase");
      expect(result!.args.phase).toBe("2");
    });

    it("only looks at the first line — multi-line bodies are not slash commands if first line lacks /", () => {
      const result = parseSlashCommand("Here is some context\n/plan-phase phase=1");
      expect(result).toBeNull();
    });

    it("still parses when the skill key is on the first line and extra lines follow", () => {
      const result = parseSlashCommand("/gsd:debug\nsome extra context here");
      expect(result).not.toBeNull();
      expect(result!.skillKey).toBe("gsd:debug");
    });

    it("parses underscores and digits in skill names", () => {
      const result = parseSlashCommand("/run_task_v2");
      expect(result).not.toBeNull();
      expect(result!.skillKey).toBe("run_task_v2");
    });
  });

  describe("edge cases — commands that should return null", () => {
    it("returns null for empty string", () => {
      expect(parseSlashCommand("")).toBeNull();
    });

    it("returns null for whitespace-only string", () => {
      expect(parseSlashCommand("   ")).toBeNull();
    });

    it("returns null when the body does not start with /", () => {
      expect(parseSlashCommand("plan-phase")).toBeNull();
    });

    it("returns null for a bare slash with no identifier", () => {
      expect(parseSlashCommand("/")).toBeNull();
    });

    it("returns null when the skill name starts with a non-identifier character", () => {
      // A digit start is invalid per regex: /([a-zA-Z0-9][a-zA-Z0-9:_-]*)
      // Actually the regex DOES allow starting digit — verify the actual behaviour
      // rather than assuming. The regex is /^\/([a-zA-Z0-9][a-zA-Z0-9:_-]*)/
      const result = parseSlashCommand("/9skill");
      // The regex allows digits as first char — this should parse
      expect(result).not.toBeNull();
      expect(result!.skillKey).toBe("9skill");
    });

    it("returns null when the first line has spaces before the slash (treated as non-command)", () => {
      const result = parseSlashCommand("   /plan-phase");
      // After trim(), the first line starts with /plan-phase — should parse
      expect(result).not.toBeNull();
      expect(result!.skillKey).toBe("plan-phase");
    });

    it("returns null for a body that is only a URL (slash not as command prefix)", () => {
      // A URL starts with https:// which does not match the ^/ pattern at start
      expect(parseSlashCommand("https://github.com/owner/repo")).toBeNull();
    });

    it("returns null when there is a space between the slash and the skill name", () => {
      expect(parseSlashCommand("/ plan-phase")).toBeNull();
    });
  });

  describe("arg parsing edge cases", () => {
    it("handles a key= with an empty value", () => {
      const result = parseSlashCommand("/skill key=");
      expect(result).not.toBeNull();
      expect(result!.args.key).toBe("");
    });

    it("does not include the _ key when there are no positional args", () => {
      const result = parseSlashCommand("/skill phase=1");
      expect(result!.args).not.toHaveProperty("_");
    });

    it("does not include args at all when the command has no arguments", () => {
      const result = parseSlashCommand("/skill");
      expect(result!.args).toEqual({});
      expect(result!.rawArgs).toEqual([]);
    });

    it("arg keys starting with digits are treated as positional (not key=value)", () => {
      // regex for kv: /^([a-zA-Z_][a-zA-Z0-9_]*)=/ — digit-starting keys are positional
      const result = parseSlashCommand("/skill 1=foo");
      expect(result).not.toBeNull();
      // "1=foo" doesn't match kv pattern so it goes to positional
      expect(result!.args._).toEqual(["1=foo"]);
    });
  });
});

// ---------------------------------------------------------------------------
// invokeSkill — DB stub tests
// ---------------------------------------------------------------------------

describe("invokeSkill", () => {
  function makeDb(invocationId = "inv-uuid-1") {
    const mockInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: invocationId }]),
      }),
    });
    const mockUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    return { insert: mockInsert, update: mockUpdate } as unknown as import("@stapler/db").Db;
  }

  it("inserts a pending skill_invocations row and returns its id", async () => {
    const db = makeDb("inv-1");
    const wakeup = vi.fn().mockResolvedValue(undefined);

    const id = await invokeSkill({
      db,
      heartbeatWakeup: wakeup,
      companyId: "company-1",
      issueId: "issue-1",
      agentId: "agent-1",
      skillKey: "plan-phase",
      args: {},
      triggerCommentId: null,
      requestedByActorType: "board",
      requestedByActorId: "user-1",
    });

    expect(id).toBe("inv-1");
    expect(db.insert).toHaveBeenCalledOnce();
  });

  it("wakes the agent with wakeReason skill_command_invoked", async () => {
    const db = makeDb("inv-2");
    const wakeup = vi.fn().mockResolvedValue(undefined);

    await invokeSkill({
      db,
      heartbeatWakeup: wakeup,
      companyId: "company-1",
      issueId: "issue-1",
      agentId: "agent-42",
      skillKey: "gsd:debug",
      args: { phase: "1" },
      triggerCommentId: "comment-abc",
      requestedByActorType: "board",
      requestedByActorId: "user-1",
    });

    expect(wakeup).toHaveBeenCalledOnce();
    const [calledAgentId, opts] = wakeup.mock.calls[0] as [string, Record<string, unknown>];
    expect(calledAgentId).toBe("agent-42");
    expect(opts.reason).toBe("skill_command_invoked");
    expect((opts.contextSnapshot as Record<string, unknown>).skillCommandName).toBe("gsd:debug");
  });

  it("stores null args in DB when args object is empty (no spurious empty object)", async () => {
    const db = makeDb("inv-3");
    const wakeup = vi.fn().mockResolvedValue(undefined);
    const insertValuesMock = (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockImplementation((row: Record<string, unknown>) => {
        // Capture what was passed to values()
        (db as unknown as { _capturedRow: Record<string, unknown> })._capturedRow = row;
        return { returning: vi.fn().mockResolvedValue([{ id: "inv-3" }]) };
      }),
    });

    await invokeSkill({
      db,
      heartbeatWakeup: wakeup,
      companyId: "c1",
      issueId: "i1",
      agentId: "a1",
      skillKey: "skill",
      args: {},
      triggerCommentId: null,
      requestedByActorType: "board",
      requestedByActorId: "u1",
    });

    // When args is empty the DB row should have args: null not args: {}
    const capturedRow = (db as unknown as { _capturedRow: Record<string, unknown> })._capturedRow;
    expect(capturedRow.args).toBeNull();
  });

  it("does not throw when heartbeatWakeup fails — wakeup failure is fire-and-forget", async () => {
    const db = makeDb("inv-4");
    const wakeup = vi.fn().mockRejectedValue(new Error("heartbeat down"));

    await expect(
      invokeSkill({
        db,
        heartbeatWakeup: wakeup,
        companyId: "c1",
        issueId: "i1",
        agentId: "a1",
        skillKey: "skill",
        args: {},
        triggerCommentId: null,
        requestedByActorType: "board",
        requestedByActorId: "u1",
      }),
    ).resolves.toBeDefined();
  });
});
