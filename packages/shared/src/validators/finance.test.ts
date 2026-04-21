/**
 * Tests for finance event validators.
 */
import { describe, expect, it } from "vitest";
import { createFinanceEventSchema } from "./index.js";

const valid = {
  eventKind: "inference_charge",
  biller: "anthropic",
  amountCents: 500,
  occurredAt: new Date().toISOString(),
};

describe("createFinanceEventSchema", () => {
  it("accepts minimal valid event", () => {
    const r = createFinanceEventSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.direction).toBe("debit");
      expect(r.data.estimated).toBe(false);
      expect(r.data.currency).toBe("USD");
    }
  });

  it("uppercases currency", () => {
    const r = createFinanceEventSchema.safeParse({ ...valid, currency: "eur" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.currency).toBe("EUR");
  });

  it("rejects empty biller", () => {
    expect(createFinanceEventSchema.safeParse({ ...valid, biller: "" }).success).toBe(false);
  });

  it("rejects negative amountCents", () => {
    expect(createFinanceEventSchema.safeParse({ ...valid, amountCents: -1 }).success).toBe(false);
  });

  it("rejects fractional amountCents", () => {
    expect(createFinanceEventSchema.safeParse({ ...valid, amountCents: 1.5 }).success).toBe(false);
  });

  it("accepts zero amountCents", () => {
    expect(createFinanceEventSchema.safeParse({ ...valid, amountCents: 0 }).success).toBe(true);
  });

  it("rejects invalid eventKind", () => {
    expect(createFinanceEventSchema.safeParse({ ...valid, eventKind: "mystery" }).success).toBe(false);
  });

  it("rejects invalid direction", () => {
    expect(createFinanceEventSchema.safeParse({ ...valid, direction: "transfer" }).success).toBe(false);
  });

  it("accepts direction=credit", () => {
    expect(createFinanceEventSchema.safeParse({ ...valid, direction: "credit" }).success).toBe(true);
  });

  it("rejects non-ISO occurredAt", () => {
    expect(createFinanceEventSchema.safeParse({ ...valid, occurredAt: "today" }).success).toBe(false);
  });

  it("accepts valid unit", () => {
    expect(
      createFinanceEventSchema.safeParse({ ...valid, unit: "input_token" }).success,
    ).toBe(true);
  });

  it("rejects invalid unit", () => {
    expect(
      createFinanceEventSchema.safeParse({ ...valid, unit: "page" }).success,
    ).toBe(false);
  });

  it("rejects currency that is not exactly 3 chars", () => {
    expect(
      createFinanceEventSchema.safeParse({ ...valid, currency: "US" }).success,
    ).toBe(false);
  });

  it("accepts optional agentId as UUID", () => {
    expect(
      createFinanceEventSchema.safeParse({
        ...valid,
        agentId: "550e8400-e29b-41d4-a716-446655440000",
      }).success,
    ).toBe(true);
  });

  it("rejects agentId as non-UUID", () => {
    expect(
      createFinanceEventSchema.safeParse({ ...valid, agentId: "bad-id" }).success,
    ).toBe(false);
  });

  it("accepts all finance event kinds", () => {
    const kinds = [
      "inference_charge",
      "platform_fee",
      "credit_purchase",
      "credit_refund",
      "credit_expiry",
      "training_charge",
      "custom_model_import_charge",
      "custom_model_storage_charge",
      "manual_adjustment",
    ];
    for (const kind of kinds) {
      expect(
        createFinanceEventSchema.safeParse({ ...valid, eventKind: kind }).success,
        `kind=${kind}`,
      ).toBe(true);
    }
  });
});
