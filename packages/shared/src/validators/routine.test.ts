import { describe, expect, it } from "vitest";
import { createRoutineSchema, routineVariableSchema, updateRoutineSchema } from "./routine.js";

describe("routineVariableSchema", () => {
  const validText = {
    name: "MY_VAR",
    type: "text" as const,
  };

  it("accepts a valid text variable", () => {
    expect(routineVariableSchema.safeParse(validText).success).toBe(true);
  });

  it("rejects name with leading digit", () => {
    expect(routineVariableSchema.safeParse({ ...validText, name: "1bad" }).success).toBe(false);
  });

  it("rejects name with hyphens", () => {
    expect(routineVariableSchema.safeParse({ ...validText, name: "bad-name" }).success).toBe(false);
  });

  it("accepts name with underscores and digits", () => {
    expect(routineVariableSchema.safeParse({ ...validText, name: "A_1_B" }).success).toBe(true);
  });

  it("rejects select type without options", () => {
    const result = routineVariableSchema.safeParse({
      name: "CHOICE",
      type: "select",
      options: [],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error)).toContain("option");
  });

  it("accepts select type with options", () => {
    const result = routineVariableSchema.safeParse({
      name: "CHOICE",
      type: "select",
      options: ["a", "b", "c"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-select type with options", () => {
    const result = routineVariableSchema.safeParse({
      name: "TXT",
      type: "text",
      options: ["should not be here"],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error)).toContain("option");
  });

  it("rejects select defaultValue not in options", () => {
    const result = routineVariableSchema.safeParse({
      name: "CHOICE",
      type: "select",
      options: ["a", "b"],
      defaultValue: "c",
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error)).toContain("defaultValue");
  });

  it("accepts select defaultValue that is in options", () => {
    const result = routineVariableSchema.safeParse({
      name: "CHOICE",
      type: "select",
      options: ["a", "b"],
      defaultValue: "a",
    });
    expect(result.success).toBe(true);
  });

  it("accepts boolean type with boolean defaultValue", () => {
    const result = routineVariableSchema.safeParse({
      name: "FLAG",
      type: "boolean",
      defaultValue: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts number type with numeric defaultValue", () => {
    const result = routineVariableSchema.safeParse({
      name: "RETRIES",
      type: "number",
      defaultValue: 3,
    });
    expect(result.success).toBe(true);
  });
});

describe("createRoutineSchema", () => {
  const valid = {
    title: "Daily standup check",
    assigneeAgentId: "550e8400-e29b-41d4-a716-446655440000",
  };

  it("accepts minimal valid routine", () => {
    const result = createRoutineSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("active");
      expect(result.data.priority).toBe("medium");
      expect(result.data.concurrencyPolicy).toBe("coalesce_if_active");
      expect(result.data.catchUpPolicy).toBe("skip_missed");
      expect(result.data.variables).toEqual([]);
    }
  });

  it("rejects empty title", () => {
    expect(createRoutineSchema.safeParse({ ...valid, title: "" }).success).toBe(false);
  });

  it("rejects title over 200 chars", () => {
    expect(
      createRoutineSchema.safeParse({ ...valid, title: "x".repeat(201) }).success,
    ).toBe(false);
  });

  it("rejects non-UUID assigneeAgentId", () => {
    expect(
      createRoutineSchema.safeParse({ ...valid, assigneeAgentId: "not-uuid" }).success,
    ).toBe(false);
  });

  it("accepts null assigneeAgentId", () => {
    expect(
      createRoutineSchema.safeParse({ ...valid, assigneeAgentId: null }).success,
    ).toBe(true);
  });

  it("accepts valid variables array", () => {
    const result = createRoutineSchema.safeParse({
      ...valid,
      variables: [{ name: "MY_VAR", type: "text" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid variable in variables array", () => {
    const result = createRoutineSchema.safeParse({
      ...valid,
      variables: [{ name: "1bad", type: "text" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("updateRoutineSchema", () => {
  it("accepts empty patch", () => {
    expect(updateRoutineSchema.safeParse({}).success).toBe(true);
  });

  it("accepts partial title update", () => {
    expect(updateRoutineSchema.safeParse({ title: "New title" }).success).toBe(true);
  });

  it("rejects invalid status in partial update", () => {
    expect(updateRoutineSchema.safeParse({ status: "deleted" }).success).toBe(false);
  });
});
