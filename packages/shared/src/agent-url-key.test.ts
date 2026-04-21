import { describe, expect, it } from "vitest";
import { deriveAgentUrlKey, isUuidLike, normalizeAgentUrlKey } from "./agent-url-key.js";

describe("isUuidLike", () => {
  it("returns true for valid v4 UUID", () => {
    expect(isUuidLike("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("returns true for uppercase UUID", () => {
    expect(isUuidLike("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
  });

  it("returns true for UUID with surrounding whitespace", () => {
    expect(isUuidLike("  550e8400-e29b-41d4-a716-446655440000  ")).toBe(true);
  });

  it("returns false for plain string", () => {
    expect(isUuidLike("my-agent")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isUuidLike(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isUuidLike(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isUuidLike("")).toBe(false);
  });

  it("returns false for UUID missing hyphens", () => {
    expect(isUuidLike("550e8400e29b41d4a716446655440000")).toBe(false);
  });
});

describe("normalizeAgentUrlKey", () => {
  it("lowercases the value", () => {
    expect(normalizeAgentUrlKey("MyAgent")).toBe("myagent");
  });

  it("replaces spaces with hyphens", () => {
    expect(normalizeAgentUrlKey("my agent name")).toBe("my-agent-name");
  });

  it("replaces special characters with hyphens", () => {
    expect(normalizeAgentUrlKey("agent@v2.0")).toBe("agent-v2-0");
  });

  it("collapses consecutive delimiters to a single hyphen", () => {
    expect(normalizeAgentUrlKey("hello   world")).toBe("hello-world");
  });

  it("trims leading/trailing hyphens", () => {
    expect(normalizeAgentUrlKey("  --my agent--  ")).toBe("my-agent");
  });

  it("returns null for null input", () => {
    expect(normalizeAgentUrlKey(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizeAgentUrlKey(undefined)).toBeNull();
  });

  it("returns null for blank string", () => {
    expect(normalizeAgentUrlKey("   ")).toBeNull();
  });

  it("returns null for string that normalises to empty", () => {
    expect(normalizeAgentUrlKey("---")).toBeNull();
  });

  it("preserves digits", () => {
    expect(normalizeAgentUrlKey("agent2")).toBe("agent2");
  });
});

describe("deriveAgentUrlKey", () => {
  it("returns slug from name", () => {
    expect(deriveAgentUrlKey("My Agent")).toBe("my-agent");
  });

  it("falls back to fallback when name is null", () => {
    expect(deriveAgentUrlKey(null, "fallback-name")).toBe("fallback-name");
  });

  it("falls back to 'agent' when both name and fallback are null", () => {
    expect(deriveAgentUrlKey(null, null)).toBe("agent");
  });

  it("falls back to 'agent' when name normalises to empty", () => {
    expect(deriveAgentUrlKey("---")).toBe("agent");
  });

  it("prefers name over fallback when name is valid", () => {
    expect(deriveAgentUrlKey("primary", "secondary")).toBe("primary");
  });
});
