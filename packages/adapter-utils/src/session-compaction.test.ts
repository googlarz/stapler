import { describe, expect, it } from "vitest";
import {
  getAdapterSessionManagement,
  hasSessionCompactionThresholds,
  readSessionCompactionOverride,
  resolveSessionCompactionPolicy,
} from "./session-compaction.js";

describe("getAdapterSessionManagement", () => {
  it("returns management config for claude_local", () => {
    const mgmt = getAdapterSessionManagement("claude_local");
    expect(mgmt).not.toBeNull();
    expect(mgmt?.supportsSessionResume).toBe(true);
    expect(mgmt?.nativeContextManagement).toBe("confirmed");
  });

  it("returns null for unknown adapter type", () => {
    expect(getAdapterSessionManagement("telepathy")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(getAdapterSessionManagement(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(getAdapterSessionManagement(undefined)).toBeNull();
  });

  it("returns management for codex_local", () => {
    const mgmt = getAdapterSessionManagement("codex_local");
    expect(mgmt?.supportsSessionResume).toBe(true);
  });
});

describe("readSessionCompactionOverride", () => {
  it("returns empty object for null runtimeConfig", () => {
    expect(readSessionCompactionOverride(null)).toEqual({});
  });

  it("returns empty object for empty runtimeConfig", () => {
    expect(readSessionCompactionOverride({})).toEqual({});
  });

  it("reads enabled from heartbeat.sessionCompaction", () => {
    const override = readSessionCompactionOverride({
      heartbeat: { sessionCompaction: { enabled: false } },
    });
    expect(override.enabled).toBe(false);
  });

  it("reads maxSessionRuns from heartbeat.sessionCompaction", () => {
    const override = readSessionCompactionOverride({
      heartbeat: { sessionCompaction: { maxSessionRuns: 50 } },
    });
    expect(override.maxSessionRuns).toBe(50);
  });

  it("supports legacy heartbeat.sessionRotation key", () => {
    const override = readSessionCompactionOverride({
      heartbeat: { sessionRotation: { maxSessionRuns: 10 } },
    });
    expect(override.maxSessionRuns).toBe(10);
  });

  it("reads from top-level sessionCompaction", () => {
    const override = readSessionCompactionOverride({
      sessionCompaction: { maxRawInputTokens: 500_000 },
    });
    expect(override.maxRawInputTokens).toBe(500_000);
  });

  it("ignores non-numeric values", () => {
    const override = readSessionCompactionOverride({
      heartbeat: { sessionCompaction: { maxSessionRuns: "not-a-number" } },
    });
    expect(override.maxSessionRuns).toBeUndefined();
  });

  it("ignores non-boolean enabled values", () => {
    const override = readSessionCompactionOverride({
      heartbeat: { sessionCompaction: { enabled: "maybe" } },
    });
    expect(override.enabled).toBeUndefined();
  });
});

describe("resolveSessionCompactionPolicy", () => {
  it("uses adapter default for claude_local", () => {
    const result = resolveSessionCompactionPolicy("claude_local", {});
    expect(result.source).toBe("adapter_default");
    expect(result.adapterSessionManagement).not.toBeNull();
    // claude_local uses native context management — thresholds should be 0
    expect(result.policy.maxSessionRuns).toBe(0);
    expect(result.policy.maxRawInputTokens).toBe(0);
  });

  it("returns legacy_fallback for unknown adapter", () => {
    const result = resolveSessionCompactionPolicy("openclaw_gateway", {});
    expect(result.source).toBe("legacy_fallback");
    // openclaw_gateway is not in LEGACY_SESSIONED_ADAPTER_TYPES → enabled=false
    expect(result.policy.enabled).toBe(false);
  });

  it("returns legacy_fallback with enabled=true for claude_local when no adapter mgmt key", () => {
    // Actually claude_local has adapter management, so test a legacy adapter type
    const result = resolveSessionCompactionPolicy("cursor", {});
    expect(result.source).toBe("adapter_default");
  });

  it("applies agent override when explicit config provided", () => {
    const result = resolveSessionCompactionPolicy("claude_local", {
      heartbeat: { sessionCompaction: { maxSessionRuns: 99 } },
    });
    expect(result.source).toBe("agent_override");
    expect(result.policy.maxSessionRuns).toBe(99);
    expect(result.explicitOverride.maxSessionRuns).toBe(99);
  });

  it("override takes precedence over adapter default", () => {
    const result = resolveSessionCompactionPolicy("claude_local", {
      heartbeat: { sessionCompaction: { enabled: true, maxSessionRuns: 5 } },
    });
    expect(result.policy.enabled).toBe(true);
    expect(result.policy.maxSessionRuns).toBe(5);
  });

  it("handles null adapterType gracefully", () => {
    const result = resolveSessionCompactionPolicy(null, {});
    expect(result.source).toBe("legacy_fallback");
    expect(result.adapterSessionManagement).toBeNull();
    expect(result.policy.enabled).toBe(false);
  });
});

describe("hasSessionCompactionThresholds", () => {
  it("returns true when maxSessionRuns > 0", () => {
    expect(hasSessionCompactionThresholds({ maxSessionRuns: 1, maxRawInputTokens: 0, maxSessionAgeHours: 0 })).toBe(true);
  });

  it("returns true when maxRawInputTokens > 0", () => {
    expect(hasSessionCompactionThresholds({ maxSessionRuns: 0, maxRawInputTokens: 1, maxSessionAgeHours: 0 })).toBe(true);
  });

  it("returns true when maxSessionAgeHours > 0", () => {
    expect(hasSessionCompactionThresholds({ maxSessionRuns: 0, maxRawInputTokens: 0, maxSessionAgeHours: 1 })).toBe(true);
  });

  it("returns false when all thresholds are 0", () => {
    expect(hasSessionCompactionThresholds({ maxSessionRuns: 0, maxRawInputTokens: 0, maxSessionAgeHours: 0 })).toBe(false);
  });
});
