import { describe, expect, it } from "vitest";
import {
  describeClaudeFailure,
  detectClaudeLoginRequired,
  extractClaudeLoginUrl,
  extractClaudeUsageLimitReset,
  isClaudeGhostResumeResult,
  isClaudeMaxTurnsResult,
  isClaudeUnknownSessionError,
  isClaudeUsageLimitResult,
  parseClaudeStreamJson,
} from "./parse.js";

describe("isClaudeUnknownSessionError", () => {
  it("detects the legacy 'no conversation found' message", () => {
    expect(
      isClaudeUnknownSessionError({
        result: "Error: No conversation found with session id 1234",
      }),
    ).toBe(true);
  });

  it("detects 'session ... not found' style errors", () => {
    expect(
      isClaudeUnknownSessionError({
        errors: ["Session abc123 not found"],
      }),
    ).toBe(true);
  });

  it("detects '--resume requires a valid session' validation error from non-UUID input", () => {
    // Real CLI error when claude --resume is given a session ID in another adapter's
    // format (e.g. an opencode "ses_*" ID after switching adapters).
    expect(
      isClaudeUnknownSessionError({
        errors: [
          'Error: --resume requires a valid session ID or session title when used with --print. Usage: claude -p --resume <session-id|title>. Provided value "ses_268c2d0a5ffemYbEaeG7c86Uvo" is not a UUID and does not match any session title.',
        ],
      }),
    ).toBe(true);
  });

  it("returns false for unrelated error text", () => {
    expect(
      isClaudeUnknownSessionError({
        result: "Some other failure",
        errors: ["Network timeout"],
      }),
    ).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// parseClaudeStreamJson
// ──────────────────────────────────────────────────────────

describe("parseClaudeStreamJson", () => {
  it("returns empty/null when stdout is empty", () => {
    const r = parseClaudeStreamJson("");
    expect(r.sessionId).toBeNull();
    expect(r.summary).toBe("");
    expect(r.resultJson).toBeNull();
    expect(r.costUsd).toBeNull();
    expect(r.usage).toBeNull();
  });

  it("extracts sessionId and model from init event", () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "sess-abc", model: "claude-sonnet" }),
    ];
    const r = parseClaudeStreamJson(lines.join("\n"));
    expect(r.sessionId).toBe("sess-abc");
    expect(r.model).toBe("claude-sonnet");
  });

  it("extracts cost and usage from result event", () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "s1", model: "m1" }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        session_id: "s1",
        result: "All done",
        total_cost_usd: 0.012,
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 },
      }),
    ];
    const r = parseClaudeStreamJson(lines.join("\n"));
    expect(r.costUsd).toBe(0.012);
    expect(r.usage?.inputTokens).toBe(100);
    expect(r.usage?.outputTokens).toBe(50);
    expect(r.usage?.cachedInputTokens).toBe(10);
    expect(r.summary).toBe("All done");
  });

  it("collects assistant text blocks when no result event", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        session_id: "s1",
        message: {
          content: [{ type: "text", text: "Hello" }, { type: "tool_use", id: "t1" }],
        },
      }),
    ];
    const r = parseClaudeStreamJson(lines.join("\n"));
    expect(r.summary).toBe("Hello");
  });

  it("ignores non-JSON lines gracefully", () => {
    const r = parseClaudeStreamJson("not json\n{\"type\":\"result\",\"result\":\"ok\"}");
    expect(r.summary).toBe("ok");
  });
});

// ──────────────────────────────────────────────────────────
// extractClaudeLoginUrl
// ──────────────────────────────────────────────────────────

describe("extractClaudeLoginUrl", () => {
  it("returns Claude auth URL from text", () => {
    const url = extractClaudeLoginUrl(
      "Please visit https://claude.ai/auth/login to authenticate.",
    );
    expect(url).toBe("https://claude.ai/auth/login");
  });

  it("returns first URL when no claude/anthropic/auth match", () => {
    const url = extractClaudeLoginUrl("See https://example.com/page for details");
    expect(url).toBe("https://example.com/page");
  });

  it("returns null when no URL in text", () => {
    expect(extractClaudeLoginUrl("no url here")).toBeNull();
  });

  it("strips trailing period from URL", () => {
    const url = extractClaudeLoginUrl("Login at https://auth.anthropic.com/oauth.");
    expect(url).toBe("https://auth.anthropic.com/oauth");
  });
});

// ──────────────────────────────────────────────────────────
// detectClaudeLoginRequired
// ──────────────────────────────────────────────────────────

describe("detectClaudeLoginRequired", () => {
  it("detects login required from result text", () => {
    const r = detectClaudeLoginRequired({
      parsed: { result: "Error: not logged in" },
      stdout: "",
      stderr: "",
    });
    expect(r.requiresLogin).toBe(true);
  });

  it("detects login required from stderr", () => {
    const r = detectClaudeLoginRequired({
      parsed: null,
      stdout: "",
      stderr: "Please log in to continue",
    });
    expect(r.requiresLogin).toBe(true);
  });

  it("returns false for unrelated failures", () => {
    const r = detectClaudeLoginRequired({
      parsed: { result: "network error" },
      stdout: "",
      stderr: "timeout",
    });
    expect(r.requiresLogin).toBe(false);
  });

  it("extracts login URL from stdout when present", () => {
    const r = detectClaudeLoginRequired({
      parsed: { result: "not logged in" },
      stdout: "Visit https://claude.ai/auth/login?code=abc to authenticate",
      stderr: "",
    });
    expect(r.requiresLogin).toBe(true);
    expect(r.loginUrl).toContain("claude.ai");
  });
});

// ──────────────────────────────────────────────────────────
// describeClaudeFailure
// ──────────────────────────────────────────────────────────

describe("describeClaudeFailure", () => {
  it("includes subtype and result text in description", () => {
    const desc = describeClaudeFailure({ subtype: "error_max_turns", result: "Too many turns" });
    expect(desc).toContain("error_max_turns");
    expect(desc).toContain("Too many turns");
  });

  it("falls back to error messages when result is empty", () => {
    const desc = describeClaudeFailure({
      errors: [{ message: "API key invalid" }],
    });
    expect(desc).toContain("API key invalid");
  });

  it("returns null when no subtype, result, or errors", () => {
    expect(describeClaudeFailure({})).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────
// isClaudeUsageLimitResult
// ──────────────────────────────────────────────────────────

describe("isClaudeUsageLimitResult", () => {
  it("detects usage limit in result text", () => {
    expect(isClaudeUsageLimitResult({ result: "You've hit your usage limit" })).toBe(true);
  });

  it("detects 'rate limit reached'", () => {
    expect(isClaudeUsageLimitResult({ result: "rate limit reached" })).toBe(true);
  });

  it("returns false for null input", () => {
    expect(isClaudeUsageLimitResult(null)).toBe(false);
  });

  it("returns false for unrelated messages", () => {
    expect(isClaudeUsageLimitResult({ result: "unexpected error" })).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// isClaudeMaxTurnsResult
// ──────────────────────────────────────────────────────────

describe("isClaudeMaxTurnsResult", () => {
  it("detects error_max_turns subtype", () => {
    expect(isClaudeMaxTurnsResult({ subtype: "error_max_turns" })).toBe(true);
  });

  it("detects stop_reason=max_turns", () => {
    expect(isClaudeMaxTurnsResult({ stop_reason: "max_turns" })).toBe(true);
  });

  it("detects 'maximum turns' in result text", () => {
    expect(isClaudeMaxTurnsResult({ result: "Reached maximum turns" })).toBe(true);
  });

  it("returns false for null input", () => {
    expect(isClaudeMaxTurnsResult(null)).toBe(false);
  });

  it("returns false for unrelated result", () => {
    expect(isClaudeMaxTurnsResult({ subtype: "success", result: "done" })).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// isClaudeGhostResumeResult
// ──────────────────────────────────────────────────────────

describe("isClaudeGhostResumeResult", () => {
  it("returns false when not a resumed session", () => {
    expect(
      isClaudeGhostResumeResult({ subtype: "success", usage: { output_tokens: 0 }, result: "" }, false),
    ).toBe(false);
  });

  it("returns false for null parsed", () => {
    expect(isClaudeGhostResumeResult(null, true)).toBe(false);
  });

  it("returns true for success with zero output tokens and empty result on resumed session", () => {
    expect(
      isClaudeGhostResumeResult(
        { subtype: "success", usage: { output_tokens: 0 }, result: "" },
        true,
      ),
    ).toBe(true);
  });

  it("returns false when output tokens > 0", () => {
    expect(
      isClaudeGhostResumeResult(
        { subtype: "success", usage: { output_tokens: 5 }, result: "" },
        true,
      ),
    ).toBe(false);
  });

  it("returns false when subtype is not success", () => {
    expect(
      isClaudeGhostResumeResult(
        { subtype: "error_max_turns", usage: { output_tokens: 0 }, result: "" },
        true,
      ),
    ).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// extractClaudeUsageLimitReset
// ──────────────────────────────────────────────────────────

describe("extractClaudeUsageLimitReset", () => {
  it("returns null for null input", () => {
    expect(extractClaudeUsageLimitReset(null)).toBeNull();
  });

  it("returns null when no reset time in message", () => {
    expect(extractClaudeUsageLimitReset({ result: "usage limit reached" })).toBeNull();
  });

  it("parses reset time with hour and am/pm from result text", () => {
    const now = new Date("2024-01-15T10:00:00Z");
    const iso = extractClaudeUsageLimitReset(
      { result: "Usage limit reached. Resets at 11pm UTC" },
      now,
    );
    expect(iso).not.toBeNull();
    if (iso) {
      const reset = new Date(iso);
      expect(reset.getUTCHours()).toBe(23); // 11pm = 23:00 UTC
    }
  });

  it("advances to next day when reset time has already passed", () => {
    const now = new Date("2024-01-15T22:00:00Z");
    const iso = extractClaudeUsageLimitReset(
      { result: "Resets at 10:00 UTC" },
      now,
    );
    expect(iso).not.toBeNull();
    if (iso) {
      const reset = new Date(iso);
      expect(reset.getTime()).toBeGreaterThan(now.getTime());
    }
  });
});
