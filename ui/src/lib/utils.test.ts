import { describe, expect, it } from "vitest";
import { visibleRunCostUsd } from "./utils";

describe("visibleRunCostUsd", () => {
  it("reads costUsd from usage", () => {
    expect(visibleRunCostUsd({ costUsd: 0.0123 })).toBe(0.0123);
  });
  it("falls back to resultJson when usage has no cost", () => {
    expect(visibleRunCostUsd(null, { costUsd: 0.005 })).toBe(0.005);
  });
  it("returns 0 for Ollama runs with no cost data", () => {
    expect(visibleRunCostUsd(null, null)).toBe(0);
  });
  it("returns 0 when billingType is subscription_included", () => {
    expect(visibleRunCostUsd({ costUsd: 0.05, billingType: "subscription_included" })).toBe(0);
  });
  it("reads cost_usd alias", () => {
    expect(visibleRunCostUsd({ cost_usd: 0.02 })).toBe(0.02);
  });
  it("reads total_cost_usd alias", () => {
    expect(visibleRunCostUsd({ total_cost_usd: 0.03 })).toBe(0.03);
  });
  it("returns 0 when costUsd is 0", () => {
    expect(visibleRunCostUsd({ costUsd: 0, inputTokens: 1000 })).toBe(0);
  });
});
