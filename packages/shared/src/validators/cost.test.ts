import { describe, it, expect } from "vitest";
import { createCostEventSchema, updateBudgetSchema } from "./cost.js";

describe("createCostEventSchema", () => {
  const validInput = {
    agentId: "550e8400-e29b-41d4-a716-446655440000",
    provider: "anthropic",
    model: "claude-3-sonnet",
    costCents: 100,
    occurredAt: "2024-01-15T10:00:00.000Z",
  };

  it("accepts minimal valid input with defaults", () => {
    const result = createCostEventSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.billingType).toBe("unknown");
      expect(result.data.inputTokens).toBe(0);
      expect(result.data.cachedInputTokens).toBe(0);
      expect(result.data.outputTokens).toBe(0);
    }
  });

  it("defaults biller to provider when not specified", () => {
    const result = createCostEventSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.biller).toBe("anthropic");
    }
  });

  it("uses explicit biller when provided", () => {
    const result = createCostEventSchema.safeParse({ ...validInput, biller: "openai" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.biller).toBe("openai");
    }
  });

  it("accepts full valid input", () => {
    const result = createCostEventSchema.safeParse({
      ...validInput,
      issueId: "550e8400-e29b-41d4-a716-446655440001",
      projectId: "550e8400-e29b-41d4-a716-446655440002",
      goalId: "550e8400-e29b-41d4-a716-446655440003",
      heartbeatRunId: "550e8400-e29b-41d4-a716-446655440004",
      billingCode: "code-123",
      billingType: "metered_api",
      inputTokens: 1000,
      cachedInputTokens: 200,
      outputTokens: 500,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    expect(createCostEventSchema.safeParse({ provider: "x", model: "y", costCents: 0, occurredAt: "2024-01-01T00:00:00Z" }).success).toBe(false);
    expect(createCostEventSchema.safeParse({ agentId: "550e8400-e29b-41d4-a716-446655440000", model: "y", costCents: 0, occurredAt: "2024-01-01T00:00:00Z" }).success).toBe(false);
  });

  it("rejects negative costCents", () => {
    expect(createCostEventSchema.safeParse({ ...validInput, costCents: -1 }).success).toBe(false);
  });

  it("rejects negative token counts", () => {
    expect(createCostEventSchema.safeParse({ ...validInput, inputTokens: -1 }).success).toBe(false);
    expect(createCostEventSchema.safeParse({ ...validInput, outputTokens: -1 }).success).toBe(false);
  });

  it("rejects non-integer token counts", () => {
    expect(createCostEventSchema.safeParse({ ...validInput, inputTokens: 1.5 }).success).toBe(false);
  });

  it("rejects invalid datetime", () => {
    expect(createCostEventSchema.safeParse({ ...validInput, occurredAt: "not-a-date" }).success).toBe(false);
  });

  it("rejects invalid billing type", () => {
    expect(createCostEventSchema.safeParse({ ...validInput, billingType: "invalid_type" }).success).toBe(false);
  });

  it("accepts all valid billing types", () => {
    const types = ["metered_api", "subscription_included", "subscription_overage", "credits", "fixed", "estimated_cost", "unknown"];
    for (const billingType of types) {
      expect(createCostEventSchema.safeParse({ ...validInput, billingType }).success).toBe(true);
    }
  });
});

describe("updateBudgetSchema", () => {
  it("accepts valid budget", () => {
    expect(updateBudgetSchema.safeParse({ budgetMonthlyCents: 10000 }).success).toBe(true);
  });

  it("accepts zero budget", () => {
    expect(updateBudgetSchema.safeParse({ budgetMonthlyCents: 0 }).success).toBe(true);
  });

  it("rejects negative budget", () => {
    expect(updateBudgetSchema.safeParse({ budgetMonthlyCents: -1 }).success).toBe(false);
  });

  it("rejects non-integer budget", () => {
    expect(updateBudgetSchema.safeParse({ budgetMonthlyCents: 1.5 }).success).toBe(false);
  });

  it("rejects missing field", () => {
    expect(updateBudgetSchema.safeParse({}).success).toBe(false);
  });
});
