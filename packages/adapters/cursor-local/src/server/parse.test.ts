import { describe, expect, it } from "vitest";
import { isCursorUnknownSessionError, parseCursorJsonl } from "./parse.js";

// ──────────────────────────────────────────────────────────
// parseCursorJsonl
// ──────────────────────────────────────────────────────────

describe("parseCursorJsonl", () => {
  it("returns empty result for empty stdout", () => {
    const r = parseCursorJsonl("");
    expect(r.sessionId).toBeNull();
    expect(r.summary).toBe("");
    expect(r.costUsd).toBeNull();
    expect(r.errorMessage).toBeNull();
    expect(r.usage.inputTokens).toBe(0);
  });

  it("extracts sessionId from session_id field", () => {
    const line = JSON.stringify({ type: "assistant", session_id: "sess-123", message: "" });
    const r = parseCursorJsonl(line);
    expect(r.sessionId).toBe("sess-123");
  });

  it("extracts sessionId from sessionId camelCase field", () => {
    const line = JSON.stringify({ type: "result", sessionId: "sess-456", result: "done" });
    const r = parseCursorJsonl(line);
    expect(r.sessionId).toBe("sess-456");
  });

  it("collects assistant message text", () => {
    const line = JSON.stringify({ type: "assistant", message: "Hello from assistant" });
    const r = parseCursorJsonl(line);
    expect(r.summary).toBe("Hello from assistant");
  });

  it("collects text from message content blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "First block" },
          { type: "tool_use", id: "t1" },
          { type: "output_text", text: "Second block" },
        ],
      },
    });
    const r = parseCursorJsonl(line);
    expect(r.summary).toContain("First block");
    expect(r.summary).toContain("Second block");
  });

  it("extracts cost and token usage from result event", () => {
    const line = JSON.stringify({
      type: "result",
      total_cost_usd: 0.025,
      usage: { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 50 },
      result: "task complete",
    });
    const r = parseCursorJsonl(line);
    expect(r.costUsd).toBe(0.025);
    expect(r.usage.inputTokens).toBe(200);
    expect(r.usage.outputTokens).toBe(100);
    expect(r.usage.cachedInputTokens).toBe(50);
  });

  it("accumulates cost across multiple result events", () => {
    const lines = [
      JSON.stringify({ type: "result", total_cost_usd: 0.01 }),
      JSON.stringify({ type: "result", total_cost_usd: 0.02 }),
    ].join("\n");
    const r = parseCursorJsonl(lines);
    expect(r.costUsd).toBeCloseTo(0.03);
  });

  it("captures error message from error event", () => {
    const line = JSON.stringify({ type: "error", message: "Connection refused" });
    const r = parseCursorJsonl(line);
    expect(r.errorMessage).toBe("Connection refused");
  });

  it("captures error from result event with is_error=true", () => {
    const line = JSON.stringify({
      type: "result",
      is_error: true,
      error: "Token limit exceeded",
    });
    const r = parseCursorJsonl(line);
    expect(r.errorMessage).toBe("Token limit exceeded");
  });

  it("handles legacy step_finish token tracking", () => {
    const line = JSON.stringify({
      type: "step_finish",
      part: {
        tokens: { input: 50, output: 25, cache: { read: 10 } },
        cost: 0.003,
      },
    });
    const r = parseCursorJsonl(line);
    expect(r.usage.inputTokens).toBe(50);
    expect(r.usage.outputTokens).toBe(25);
    expect(r.usage.cachedInputTokens).toBe(10);
    expect(r.costUsd).toBeCloseTo(0.003);
  });

  it("ignores non-JSON lines", () => {
    const lines = ["not valid json", JSON.stringify({ type: "result", result: "ok" })].join("\n");
    const r = parseCursorJsonl(lines);
    expect(r.summary).toBe("ok");
  });

  it("handles legacy text event type", () => {
    const line = JSON.stringify({ type: "text", part: { text: "legacy text block" } });
    const r = parseCursorJsonl(line);
    expect(r.summary).toBe("legacy text block");
  });
});

// ──────────────────────────────────────────────────────────
// isCursorUnknownSessionError
// ──────────────────────────────────────────────────────────

describe("isCursorUnknownSessionError", () => {
  it("detects 'unknown session' in stdout", () => {
    expect(isCursorUnknownSessionError("Error: unknown session abc123", "")).toBe(true);
  });

  it("detects 'session not found' in stderr", () => {
    expect(isCursorUnknownSessionError("", "session abc123 not found")).toBe(true);
  });

  it("detects 'unknown chat'", () => {
    expect(isCursorUnknownSessionError("Error: unknown chat 789", "")).toBe(true);
  });

  it("detects 'could not resume'", () => {
    expect(isCursorUnknownSessionError("could not resume previous session", "")).toBe(true);
  });

  it("returns false for unrelated output", () => {
    expect(isCursorUnknownSessionError("network timeout", "some error")).toBe(false);
  });

  it("returns false for empty stdout and stderr", () => {
    expect(isCursorUnknownSessionError("", "")).toBe(false);
  });
});
