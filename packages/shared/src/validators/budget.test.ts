import { describe, expect, it } from "vitest";
import { resolveBudgetIncidentSchema, upsertBudgetPolicySchema } from "./budget.js";

describe("upsertBudgetPolicySchema", () => {
  const valid = {
    scopeType: "agent",
    scopeId: "550e8400-e29b-41d4-a716-446655440000",
    amount: 5000,
  };

  it("accepts minimal valid policy", () => {
    const result = upsertBudgetPolicySchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metric).toBe("billed_cents");
      expect(result.data.windowKind).toBe("calendar_month_utc");
      expect(result.data.warnPercent).toBe(80);
      expect(result.data.hardStopEnabled).toBe(true);
    }
  });

  it("rejects negative amount", () => {
    expect(upsertBudgetPolicySchema.safeParse({ ...valid, amount: -1 }).success).toBe(false);
  });

  it("accepts zero amount", () => {
    expect(upsertBudgetPolicySchema.safeParse({ ...valid, amount: 0 }).success).toBe(true);
  });

  it("rejects fractional amount", () => {
    expect(upsertBudgetPolicySchema.safeParse({ ...valid, amount: 1.5 }).success).toBe(false);
  });

  it("rejects warnPercent of 0", () => {
    expect(upsertBudgetPolicySchema.safeParse({ ...valid, warnPercent: 0 }).success).toBe(false);
  });

  it("rejects warnPercent of 100", () => {
    expect(upsertBudgetPolicySchema.safeParse({ ...valid, warnPercent: 100 }).success).toBe(false);
  });

  it("accepts warnPercent of 99", () => {
    expect(upsertBudgetPolicySchema.safeParse({ ...valid, warnPercent: 99 }).success).toBe(true);
  });

  it("accepts warnPercent of 1", () => {
    expect(upsertBudgetPolicySchema.safeParse({ ...valid, warnPercent: 1 }).success).toBe(true);
  });

  it("rejects non-UUID scopeId", () => {
    expect(upsertBudgetPolicySchema.safeParse({ ...valid, scopeId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects invalid scopeType", () => {
    expect(upsertBudgetPolicySchema.safeParse({ ...valid, scopeType: "team" }).success).toBe(false);
  });

  it("rejects invalid metric", () => {
    expect(upsertBudgetPolicySchema.safeParse({ ...valid, metric: "tokens" }).success).toBe(false);
  });
});

describe("resolveBudgetIncidentSchema", () => {
  it("accepts keep_paused action without amount", () => {
    const result = resolveBudgetIncidentSchema.safeParse({
      action: "keep_paused",
    });
    expect(result.success).toBe(true);
  });

  it("accepts raise_budget_and_resume with amount", () => {
    const result = resolveBudgetIncidentSchema.safeParse({
      action: "raise_budget_and_resume",
      amount: 10000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects raise_budget_and_resume without amount", () => {
    const result = resolveBudgetIncidentSchema.safeParse({
      action: "raise_budget_and_resume",
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error)).toContain("amount");
  });

  it("accepts optional decisionNote", () => {
    const result = resolveBudgetIncidentSchema.safeParse({
      action: "keep_paused",
      decisionNote: "Board approved overage",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null decisionNote", () => {
    const result = resolveBudgetIncidentSchema.safeParse({
      action: "keep_paused",
      decisionNote: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown action", () => {
    expect(
      resolveBudgetIncidentSchema.safeParse({ action: "delete_everything" }).success,
    ).toBe(false);
  });
});
