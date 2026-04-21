import { describe, expect, it } from "vitest";
import {
  describeGeminiFailure,
  detectGeminiAuthRequired,
  detectGeminiQuotaExhausted,
  isGeminiTurnLimitResult,
  isGeminiUnknownSessionError,
  parseGeminiJsonl,
} from "./parse.js";

// ──────────────────────────────────────────────────────────
// parseGeminiJsonl
// ──────────────────────────────────────────────────────────

describe("parseGeminiJsonl", () => {
  it("returns empty result for empty stdout", () => {
    const r = parseGeminiJsonl("");
    expect(r.sessionId).toBeNull();
    expect(r.summary).toBe("");
    expect(r.costUsd).toBeNull();
    expect(r.errorMessage).toBeNull();
    expect(r.usage.inputTokens).toBe(0);
    expect(r.question).toBeNull();
  });

  it("extracts sessionId from event", () => {
    const line = JSON.stringify({ type: "assistant", session_id: "gem-sess-1", message: "" });
    expect(parseGeminiJsonl(line).sessionId).toBe("gem-sess-1");
  });

  it("collects assistant message text", () => {
    const line = JSON.stringify({ type: "assistant", message: "Hello from Gemini" });
    expect(parseGeminiJsonl(line).summary).toBe("Hello from Gemini");
  });

  it("extracts cost from result event", () => {
    const line = JSON.stringify({
      type: "result",
      total_cost_usd: 0.005,
      usage: { input_tokens: 100, output_tokens: 50 },
      result: "task done",
    });
    const r = parseGeminiJsonl(line);
    expect(r.costUsd).toBe(0.005);
    expect(r.usage.inputTokens).toBe(100);
    expect(r.usage.outputTokens).toBe(50);
  });

  it("captures error from error event", () => {
    const line = JSON.stringify({ type: "error", message: "quota exceeded" });
    expect(parseGeminiJsonl(line).errorMessage).toBe("quota exceeded");
  });

  it("captures error from result with is_error=true", () => {
    const line = JSON.stringify({ type: "result", is_error: true, error: "token limit" });
    expect(parseGeminiJsonl(line).errorMessage).toBe("token limit");
  });

  it("ignores non-JSON lines", () => {
    const lines = ["garbage line", JSON.stringify({ type: "result", result: "ok" })].join("\n");
    expect(parseGeminiJsonl(lines).summary).toBe("ok");
  });

  it("extracts question block from assistant message content", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "question",
            prompt: "Which option?",
            choices: [
              { key: "a", label: "Option A" },
              { key: "b", label: "Option B", description: "With note" },
            ],
          },
        ],
      },
    });
    const r = parseGeminiJsonl(line);
    expect(r.question?.prompt).toBe("Which option?");
    expect(r.question?.choices).toHaveLength(2);
    expect(r.question?.choices[1].description).toBe("With note");
  });
});

// ──────────────────────────────────────────────────────────
// isGeminiUnknownSessionError
// ──────────────────────────────────────────────────────────

describe("isGeminiUnknownSessionError", () => {
  it("detects 'unknown session' in stdout", () => {
    expect(isGeminiUnknownSessionError("Error: unknown session abc", "")).toBe(true);
  });

  it("detects 'cannot resume' in stderr", () => {
    expect(isGeminiUnknownSessionError("", "cannot resume previous session")).toBe(true);
  });

  it("detects 'failed to resume'", () => {
    expect(isGeminiUnknownSessionError("failed to resume checkpoint 123", "")).toBe(true);
  });

  it("returns false for unrelated output", () => {
    expect(isGeminiUnknownSessionError("network error", "connection timeout")).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// describeGeminiFailure
// ──────────────────────────────────────────────────────────

describe("describeGeminiFailure", () => {
  it("includes status in description", () => {
    const desc = describeGeminiFailure({ status: "turn_limit", error: "Too many turns" });
    expect(desc).toContain("turn_limit");
    expect(desc).toContain("Too many turns");
  });

  it("returns null when nothing to describe", () => {
    expect(describeGeminiFailure({})).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────
// detectGeminiAuthRequired
// ──────────────────────────────────────────────────────────

describe("detectGeminiAuthRequired", () => {
  it("detects auth required from stderr", () => {
    const r = detectGeminiAuthRequired({
      parsed: null,
      stdout: "",
      stderr: "api_key missing — run gemini auth login first",
    });
    expect(r.requiresAuth).toBe(true);
  });

  it("detects 'not logged in' in result", () => {
    const r = detectGeminiAuthRequired({
      parsed: { error: "not logged in" },
      stdout: "",
      stderr: "",
    });
    expect(r.requiresAuth).toBe(true);
  });

  it("returns false for unrelated messages", () => {
    const r = detectGeminiAuthRequired({
      parsed: { error: "network timeout" },
      stdout: "",
      stderr: "",
    });
    expect(r.requiresAuth).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// detectGeminiQuotaExhausted
// ──────────────────────────────────────────────────────────

describe("detectGeminiQuotaExhausted", () => {
  it("detects RESOURCE_EXHAUSTED", () => {
    const r = detectGeminiQuotaExhausted({
      parsed: null,
      stdout: "RESOURCE_EXHAUSTED: quota exceeded",
      stderr: "",
    });
    expect(r.exhausted).toBe(true);
  });

  it("detects 429 error code", () => {
    const r = detectGeminiQuotaExhausted({
      parsed: null,
      stdout: "Error 429: too many requests",
      stderr: "",
    });
    expect(r.exhausted).toBe(true);
  });

  it("returns false for unrelated error", () => {
    const r = detectGeminiQuotaExhausted({
      parsed: { error: "connection refused" },
      stdout: "",
      stderr: "",
    });
    expect(r.exhausted).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// isGeminiTurnLimitResult
// ──────────────────────────────────────────────────────────

describe("isGeminiTurnLimitResult", () => {
  it("detects via exit code 53", () => {
    expect(isGeminiTurnLimitResult(null, 53)).toBe(true);
  });

  it("detects status=turn_limit", () => {
    expect(isGeminiTurnLimitResult({ status: "turn_limit" })).toBe(true);
  });

  it("detects status=max_turns", () => {
    expect(isGeminiTurnLimitResult({ status: "max_turns" })).toBe(true);
  });

  it("returns false for null input", () => {
    expect(isGeminiTurnLimitResult(null)).toBe(false);
  });

  it("returns false for unrelated status", () => {
    expect(isGeminiTurnLimitResult({ status: "success" })).toBe(false);
  });
});
