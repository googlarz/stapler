/**
 * Tests for server-side feedback redaction utilities.
 */
import { describe, expect, it } from "vitest";
import {
  createFeedbackRedactionState,
  finalizeFeedbackRedactionSummary,
  sanitizeFeedbackText,
  sanitizeFeedbackValue,
  sha256Digest,
  stableStringify,
} from "../services/feedback-redaction.js";

// ──────────────────────────────────────────────────────────
// stableStringify
// ──────────────────────────────────────────────────────────

describe("stableStringify", () => {
  it("serializes a primitive number", () => {
    expect(stableStringify(42)).toBe("42");
  });

  it("serializes null", () => {
    expect(stableStringify(null)).toBe("null");
  });

  it("serializes a string", () => {
    expect(stableStringify("hi")).toBe('"hi"');
  });

  it("serializes an array preserving order", () => {
    expect(stableStringify([1, 2, 3])).toBe("[1,2,3]");
  });

  it("sorts object keys alphabetically", () => {
    const obj = { z: 1, a: 2, m: 3 };
    const result = stableStringify(obj);
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it("produces the same output regardless of key insertion order", () => {
    const a = stableStringify({ b: 2, a: 1 });
    const b = stableStringify({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it("recurses into nested objects", () => {
    const result = stableStringify({ outer: { z: 1, a: 2 } });
    expect(result).toBe('{"outer":{"a":2,"z":1}}');
  });
});

// ──────────────────────────────────────────────────────────
// sha256Digest
// ──────────────────────────────────────────────────────────

describe("sha256Digest", () => {
  it("returns a 64-char hex string", () => {
    const hash = sha256Digest("hello");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("produces stable output for same input", () => {
    expect(sha256Digest({ a: 1 })).toBe(sha256Digest({ a: 1 }));
  });

  it("produces different hashes for different inputs", () => {
    expect(sha256Digest({ a: 1 })).not.toBe(sha256Digest({ b: 1 }));
  });

  it("produces same hash for same object regardless of key order", () => {
    expect(sha256Digest({ b: 2, a: 1 })).toBe(sha256Digest({ a: 1, b: 2 }));
  });
});

// ──────────────────────────────────────────────────────────
// createFeedbackRedactionState
// ──────────────────────────────────────────────────────────

describe("createFeedbackRedactionState", () => {
  it("returns empty sets and maps", () => {
    const state = createFeedbackRedactionState();
    expect(state.redactedFields.size).toBe(0);
    expect(state.truncatedFields.size).toBe(0);
    expect(state.omittedFields.size).toBe(0);
    expect(state.notes.size).toBe(0);
    expect(state.counts.size).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────
// sanitizeFeedbackText
// ──────────────────────────────────────────────────────────

describe("sanitizeFeedbackText", () => {
  it("passes through clean text unchanged", () => {
    const state = createFeedbackRedactionState();
    const result = sanitizeFeedbackText("Hello world!", state, "body", 10_000);
    expect(result).toBe("Hello world!");
    expect(state.redactedFields.size).toBe(0);
  });

  it("redacts API key pattern (sk-...)", () => {
    const state = createFeedbackRedactionState();
    const result = sanitizeFeedbackText(
      "My key is sk-ant-api03-xyz1234567890abcdef",
      state,
      "body",
      10_000,
    );
    expect(result).toContain("[REDACTED_API_KEY]");
    expect(result).not.toContain("sk-ant-api03");
    expect(state.redactedFields.has("body")).toBe(true);
  });

  it("redacts Bearer token", () => {
    const state = createFeedbackRedactionState();
    const result = sanitizeFeedbackText(
      "Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.payload.signature",
      state,
      "header",
      10_000,
    );
    expect(result).toContain("[REDACTED");
    expect(state.redactedFields.has("header")).toBe(true);
  });

  it("redacts email addresses", () => {
    const state = createFeedbackRedactionState();
    const result = sanitizeFeedbackText("Contact me at foo@example.com please", state, "msg", 10_000);
    expect(result).toContain("[REDACTED_EMAIL]");
    expect(result).not.toContain("foo@example.com");
  });

  it("redacts connection string (postgres URL)", () => {
    const state = createFeedbackRedactionState();
    const result = sanitizeFeedbackText(
      "DB: postgresql://admin:pass@localhost:5432/mydb",
      state,
      "config",
      10_000,
    );
    expect(result).toContain("[REDACTED_CONNECTION_STRING]");
  });

  it("redacts secret=value pattern", () => {
    const state = createFeedbackRedactionState();
    const result = sanitizeFeedbackText("api_key=my-secret-value-1234", state, "env", 10_000);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("my-secret-value-1234");
  });

  it("truncates text that exceeds maxLength", () => {
    const state = createFeedbackRedactionState();
    const result = sanitizeFeedbackText("a".repeat(200), state, "content", 50);
    // Slice to maxLength-1 then append "..." → length = maxLength - 1 + 3
    expect(result.length).toBeLessThanOrEqual(55);
    expect(result.endsWith("...")).toBe(true);
    expect(state.truncatedFields.has("content")).toBe(true);
  });

  it("does not add to truncatedFields when text is within limit", () => {
    const state = createFeedbackRedactionState();
    sanitizeFeedbackText("short", state, "f", 1000);
    expect(state.truncatedFields.size).toBe(0);
  });

  it("redacts PEM block", () => {
    const pem = `-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAtest\n-----END RSA PRIVATE KEY-----`;
    const state = createFeedbackRedactionState();
    const result = sanitizeFeedbackText(pem, state, "key", 100_000);
    expect(result).toContain("[REDACTED_PEM_BLOCK]");
    expect(result).not.toContain("BEGIN RSA");
  });
});

// ──────────────────────────────────────────────────────────
// sanitizeFeedbackValue
// ──────────────────────────────────────────────────────────

describe("sanitizeFeedbackValue", () => {
  it("passes through numbers unchanged", () => {
    const state = createFeedbackRedactionState();
    expect(sanitizeFeedbackValue(42, state, "n", 1000)).toBe(42);
  });

  it("passes through booleans unchanged", () => {
    const state = createFeedbackRedactionState();
    expect(sanitizeFeedbackValue(true, state, "b", 1000)).toBe(true);
  });

  it("passes through null unchanged", () => {
    const state = createFeedbackRedactionState();
    expect(sanitizeFeedbackValue(null, state, "v", 1000)).toBeNull();
  });

  it("sanitizes strings", () => {
    const state = createFeedbackRedactionState();
    const result = sanitizeFeedbackValue("foo@bar.com", state, "email", 1000);
    expect(result).toContain("[REDACTED_EMAIL]");
  });

  it("recurses into arrays", () => {
    const state = createFeedbackRedactionState();
    const result = sanitizeFeedbackValue(
      ["clean text", "contact foo@example.com"],
      state,
      "items",
      10_000,
    ) as string[];
    expect(result[0]).toBe("clean text");
    expect(result[1]).toContain("[REDACTED_EMAIL]");
  });

  it("recurses into objects", () => {
    const state = createFeedbackRedactionState();
    const result = sanitizeFeedbackValue(
      { note: "email me at alice@example.com", count: 5 },
      state,
      "payload",
      10_000,
    ) as Record<string, unknown>;
    expect((result.note as string)).toContain("[REDACTED_EMAIL]");
    expect(result.count).toBe(5);
  });
});

// ──────────────────────────────────────────────────────────
// finalizeFeedbackRedactionSummary
// ──────────────────────────────────────────────────────────

describe("finalizeFeedbackRedactionSummary", () => {
  it("returns strategy=deterministic_feedback_v2", () => {
    const summary = finalizeFeedbackRedactionSummary(createFeedbackRedactionState());
    expect(summary.strategy).toBe("deterministic_feedback_v2");
  });

  it("returns sorted redactedFields", () => {
    const state = createFeedbackRedactionState();
    state.redactedFields.add("z_field");
    state.redactedFields.add("a_field");
    const summary = finalizeFeedbackRedactionSummary(state);
    expect(summary.redactedFields).toEqual(["a_field", "z_field"]);
  });

  it("returns counts as plain object sorted by key", () => {
    const state = createFeedbackRedactionState();
    state.counts.set("z_pattern", 2);
    state.counts.set("a_pattern", 1);
    const summary = finalizeFeedbackRedactionSummary(state);
    const keys = Object.keys(summary.counts);
    expect(keys[0]).toBe("a_pattern");
    expect(keys[1]).toBe("z_pattern");
  });

  it("returns empty arrays when nothing was redacted", () => {
    const summary = finalizeFeedbackRedactionSummary(createFeedbackRedactionState());
    expect(summary.redactedFields).toEqual([]);
    expect(summary.truncatedFields).toEqual([]);
    expect(summary.omittedFields).toEqual([]);
  });
});
