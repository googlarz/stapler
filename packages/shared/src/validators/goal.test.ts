import { describe, expect, it } from "vitest";
import {
  createGoalSchema,
  goalAcceptanceCriteriaArraySchema,
  goalAcceptanceCriterionSchema,
  MAX_GOAL_ACCEPTANCE_CRITERIA,
  updateGoalSchema,
} from "./goal.js";

describe("goalAcceptanceCriterionSchema", () => {
  it("accepts a valid criterion", () => {
    const result = goalAcceptanceCriterionSchema.safeParse({
      id: "crit-1",
      text: "Must complete without errors",
      required: true,
      order: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty id", () => {
    const result = goalAcceptanceCriterionSchema.safeParse({
      id: "",
      text: "Some text",
      required: true,
      order: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty text", () => {
    const result = goalAcceptanceCriterionSchema.safeParse({
      id: "crit-1",
      text: "",
      required: true,
      order: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative order", () => {
    const result = goalAcceptanceCriterionSchema.safeParse({
      id: "crit-1",
      text: "Some text",
      required: true,
      order: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects fractional order", () => {
    const result = goalAcceptanceCriterionSchema.safeParse({
      id: "crit-1",
      text: "Some text",
      required: false,
      order: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects text longer than 1000 chars", () => {
    const result = goalAcceptanceCriterionSchema.safeParse({
      id: "crit-1",
      text: "x".repeat(1001),
      required: true,
      order: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe("goalAcceptanceCriteriaArraySchema", () => {
  const makeCrit = (id: string, order: number) => ({
    id,
    text: `Criterion ${id}`,
    required: true,
    order,
  });

  it("accepts empty array", () => {
    expect(goalAcceptanceCriteriaArraySchema.safeParse([]).success).toBe(true);
  });

  it("accepts array with valid unique criteria", () => {
    const result = goalAcceptanceCriteriaArraySchema.safeParse([
      makeCrit("a", 0),
      makeCrit("b", 1),
      makeCrit("c", 2),
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects duplicate ids", () => {
    const result = goalAcceptanceCriteriaArraySchema.safeParse([
      makeCrit("a", 0),
      makeCrit("a", 1),
    ]);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error)).toContain("unique");
  });

  it("rejects duplicate order values", () => {
    const result = goalAcceptanceCriteriaArraySchema.safeParse([
      makeCrit("a", 0),
      makeCrit("b", 0),
    ]);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error)).toContain("unique");
  });

  it(`rejects more than ${MAX_GOAL_ACCEPTANCE_CRITERIA} criteria`, () => {
    const tooMany = Array.from({ length: MAX_GOAL_ACCEPTANCE_CRITERIA + 1 }, (_, i) =>
      makeCrit(`c${i}`, i),
    );
    const result = goalAcceptanceCriteriaArraySchema.safeParse(tooMany);
    expect(result.success).toBe(false);
  });

  it(`accepts exactly ${MAX_GOAL_ACCEPTANCE_CRITERIA} criteria`, () => {
    const maxCriteria = Array.from({ length: MAX_GOAL_ACCEPTANCE_CRITERIA }, (_, i) =>
      makeCrit(`c${i}`, i),
    );
    const result = goalAcceptanceCriteriaArraySchema.safeParse(maxCriteria);
    expect(result.success).toBe(true);
  });
});

describe("createGoalSchema", () => {
  it("accepts minimal valid goal", () => {
    const result = createGoalSchema.safeParse({ title: "Ship it" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.level).toBe("task");
      expect(result.data.status).toBe("planned");
    }
  });

  it("rejects missing title", () => {
    expect(createGoalSchema.safeParse({}).success).toBe(false);
  });

  it("rejects empty title", () => {
    expect(createGoalSchema.safeParse({ title: "" }).success).toBe(false);
  });

  it("accepts null description (clearing)", () => {
    const result = createGoalSchema.safeParse({ title: "T", description: null });
    expect(result.success).toBe(true);
  });

  it("accepts empty string description", () => {
    const result = createGoalSchema.safeParse({ title: "T", description: "" });
    expect(result.success).toBe(true);
  });

  it("accepts valid level values", () => {
    for (const level of ["company", "team", "agent", "task"] as const) {
      const result = createGoalSchema.safeParse({ title: "T", level });
      expect(result.success, `level=${level}`).toBe(true);
    }
  });

  it("rejects invalid level", () => {
    expect(createGoalSchema.safeParse({ title: "T", level: "sprints" }).success).toBe(false);
  });

  it("accepts valid status values", () => {
    for (const status of ["planned", "active", "achieved", "cancelled"] as const) {
      const result = createGoalSchema.safeParse({ title: "T", status });
      expect(result.success, `status=${status}`).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    expect(createGoalSchema.safeParse({ title: "T", status: "deleted" }).success).toBe(false);
  });

  it("accepts valid UUID parentId", () => {
    const result = createGoalSchema.safeParse({
      title: "T",
      parentId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID parentId", () => {
    expect(createGoalSchema.safeParse({ title: "T", parentId: "not-a-uuid" }).success).toBe(false);
  });

  it("accepts null parentId (remove parent)", () => {
    expect(createGoalSchema.safeParse({ title: "T", parentId: null }).success).toBe(true);
  });

  it("accepts valid YYYY-MM-DD targetDate", () => {
    expect(createGoalSchema.safeParse({ title: "T", targetDate: "2026-12-31" }).success).toBe(true);
  });

  it("rejects invalid calendar date 2026-02-30", () => {
    expect(createGoalSchema.safeParse({ title: "T", targetDate: "2026-02-30" }).success).toBe(false);
  });

  it("rejects impossible month 2026-13-01", () => {
    expect(createGoalSchema.safeParse({ title: "T", targetDate: "2026-13-01" }).success).toBe(false);
  });

  it("rejects wrong date format", () => {
    expect(createGoalSchema.safeParse({ title: "T", targetDate: "31/12/2026" }).success).toBe(false);
  });

  it("accepts null targetDate (clearing)", () => {
    expect(createGoalSchema.safeParse({ title: "T", targetDate: null }).success).toBe(true);
  });
});

describe("updateGoalSchema", () => {
  it("accepts empty object (no-op patch)", () => {
    expect(updateGoalSchema.safeParse({}).success).toBe(true);
  });

  it("accepts partial update with only description", () => {
    expect(updateGoalSchema.safeParse({ description: "new desc" }).success).toBe(true);
  });

  it("accepts clearing description to null", () => {
    expect(updateGoalSchema.safeParse({ description: null }).success).toBe(true);
  });

  it("accepts partial update with only parentId", () => {
    const result = updateGoalSchema.safeParse({
      parentId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });

  it("accepts clearing parentId to null", () => {
    expect(updateGoalSchema.safeParse({ parentId: null }).success).toBe(true);
  });

  it("still rejects invalid targetDate in update", () => {
    expect(updateGoalSchema.safeParse({ targetDate: "2026-02-30" }).success).toBe(false);
  });
});
