import { describe, expect, it } from "vitest";
import { goalAcceptanceCriterionSchema, createGoalSchema } from "@paperclipai/shared";
import { goalService } from "../services/goals.ts";

describe("goalAcceptanceCriterionSchema", () => {
  it("accepts a well-formed criterion", () => {
    const parsed = goalAcceptanceCriterionSchema.parse({
      id: "c-1",
      text: "Deliverable is published to the shared drive",
      required: true,
      order: 0,
    });
    expect(parsed.id).toBe("c-1");
    expect(parsed.required).toBe(true);
  });

  it("rejects empty text", () => {
    expect(() =>
      goalAcceptanceCriterionSchema.parse({
        id: "c-1",
        text: "",
        required: true,
        order: 0,
      }),
    ).toThrow();
  });

  it("rejects negative order", () => {
    expect(() =>
      goalAcceptanceCriterionSchema.parse({
        id: "c-1",
        text: "do the thing",
        required: true,
        order: -1,
      }),
    ).toThrow();
  });

  it("rejects text over 1000 chars", () => {
    expect(() =>
      goalAcceptanceCriterionSchema.parse({
        id: "c-1",
        text: "x".repeat(1001),
        required: true,
        order: 0,
      }),
    ).toThrow();
  });
});

describe("createGoalSchema — acceptance criteria and target date", () => {
  it("accepts a goal with criteria and target date", () => {
    const parsed = createGoalSchema.parse({
      title: "Ship Q2 launch",
      acceptanceCriteria: [
        { id: "c-1", text: "landing page live", required: true, order: 0 },
        { id: "c-2", text: "press release sent", required: false, order: 1 },
      ],
      targetDate: "2026-06-30",
    });
    expect(parsed.acceptanceCriteria).toHaveLength(2);
    expect(parsed.targetDate).toBe("2026-06-30");
  });

  it("accepts a goal without criteria (backwards compatible)", () => {
    const parsed = createGoalSchema.parse({ title: "Simple goal" });
    expect(parsed.acceptanceCriteria).toBeUndefined();
    expect(parsed.targetDate).toBeUndefined();
  });

  it("rejects an invalid target date format", () => {
    expect(() =>
      createGoalSchema.parse({ title: "x", targetDate: "2026/06/30" }),
    ).toThrow();
  });

  it("rejects a nonsense calendar date like 2026-13-45", () => {
    expect(() =>
      createGoalSchema.parse({ title: "x", targetDate: "2026-13-45" }),
    ).toThrow();
  });

  it("rejects a February 30 date", () => {
    expect(() =>
      createGoalSchema.parse({ title: "x", targetDate: "2026-02-30" }),
    ).toThrow();
  });

  it("rejects duplicate criterion ids", () => {
    expect(() =>
      createGoalSchema.parse({
        title: "x",
        acceptanceCriteria: [
          { id: "c-1", text: "a", required: true, order: 0 },
          { id: "c-1", text: "b", required: true, order: 1 },
        ],
      }),
    ).toThrow();
  });

  it("rejects duplicate criterion order values", () => {
    expect(() =>
      createGoalSchema.parse({
        title: "x",
        acceptanceCriteria: [
          { id: "c-1", text: "a", required: true, order: 0 },
          { id: "c-2", text: "b", required: true, order: 0 },
        ],
      }),
    ).toThrow();
  });

  it("rejects more than 50 criteria", () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => ({
      id: `c-${i}`,
      text: `criterion ${i}`,
      required: true,
      order: i,
    }));
    expect(() =>
      createGoalSchema.parse({ title: "x", acceptanceCriteria: tooMany }),
    ).toThrow();
  });

  it("accepts exactly 50 criteria (boundary)", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => ({
      id: `c-${i}`,
      text: `criterion ${i}`,
      required: true,
      order: i,
    }));
    expect(() =>
      createGoalSchema.parse({ title: "x", acceptanceCriteria: fifty }),
    ).not.toThrow();
  });
});

describe("goalService.getProgress", () => {
  function createDbStub(rows: Array<{ totalIssues: number; doneIssues: number }>) {
    const where = async () => rows;
    const from = () => ({ where });
    const select = () => ({ from });
    return { select } as unknown as Parameters<typeof goalService>[0];
  }

  it("returns zeros when no issues are linked", async () => {
    const svc = goalService(createDbStub([{ totalIssues: 0, doneIssues: 0 }]));
    const progress = await svc.getProgress("company-1", "goal-1");
    expect(progress).toEqual({ totalIssues: 0, doneIssues: 0, completionPct: 0 });
  });

  it("rounds completion percentage to nearest integer", async () => {
    const svc = goalService(createDbStub([{ totalIssues: 3, doneIssues: 1 }]));
    const progress = await svc.getProgress("company-1", "goal-1");
    expect(progress).toEqual({ totalIssues: 3, doneIssues: 1, completionPct: 33 });
  });

  it("returns 100 when all issues done", async () => {
    const svc = goalService(createDbStub([{ totalIssues: 5, doneIssues: 5 }]));
    const progress = await svc.getProgress("company-1", "goal-1");
    expect(progress.completionPct).toBe(100);
  });

  it("handles missing row gracefully", async () => {
    const svc = goalService(createDbStub([]));
    const progress = await svc.getProgress("company-1", "goal-1");
    expect(progress).toEqual({ totalIssues: 0, doneIssues: 0, completionPct: 0 });
  });
});
