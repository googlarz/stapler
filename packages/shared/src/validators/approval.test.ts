import { describe, it, expect } from "vitest";
import {
  createApprovalSchema,
  resolveApprovalSchema,
  requestApprovalRevisionSchema,
  resubmitApprovalSchema,
  addApprovalCommentSchema,
} from "./approval.js";

describe("createApprovalSchema", () => {
  const validInput = {
    type: "hire_agent",
    payload: { agentName: "Bot" },
  };

  it("accepts minimal valid input", () => {
    expect(createApprovalSchema.safeParse(validInput).success).toBe(true);
  });

  it("accepts all valid approval types", () => {
    const types = ["hire_agent", "approve_ceo_strategy", "budget_override_required", "request_board_approval"];
    for (const type of types) {
      expect(createApprovalSchema.safeParse({ ...validInput, type }).success).toBe(true);
    }
  });

  it("accepts optional fields", () => {
    const result = createApprovalSchema.safeParse({
      ...validInput,
      requestedByAgentId: "550e8400-e29b-41d4-a716-446655440000",
      issueIds: ["550e8400-e29b-41d4-a716-446655440001"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid approval type", () => {
    expect(createApprovalSchema.safeParse({ ...validInput, type: "invalid_type" }).success).toBe(false);
  });

  it("rejects missing payload", () => {
    expect(createApprovalSchema.safeParse({ type: "hire_agent" }).success).toBe(false);
  });

  it("rejects invalid uuid in requestedByAgentId", () => {
    expect(createApprovalSchema.safeParse({ ...validInput, requestedByAgentId: "not-uuid" }).success).toBe(false);
  });

  it("rejects invalid uuid in issueIds", () => {
    expect(createApprovalSchema.safeParse({ ...validInput, issueIds: ["not-uuid"] }).success).toBe(false);
  });

  it("accepts null requestedByAgentId", () => {
    expect(createApprovalSchema.safeParse({ ...validInput, requestedByAgentId: null }).success).toBe(true);
  });
});

describe("resolveApprovalSchema", () => {
  it("accepts empty object with defaults", () => {
    const result = resolveApprovalSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decidedByUserId).toBe("board");
    }
  });

  it("accepts with decision note", () => {
    expect(resolveApprovalSchema.safeParse({ decisionNote: "Looks good" }).success).toBe(true);
  });

  it("accepts null decisionNote", () => {
    expect(resolveApprovalSchema.safeParse({ decisionNote: null }).success).toBe(true);
  });

  it("accepts custom decidedByUserId", () => {
    const result = resolveApprovalSchema.safeParse({ decidedByUserId: "user-123" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decidedByUserId).toBe("user-123");
    }
  });
});

describe("requestApprovalRevisionSchema", () => {
  it("accepts empty object", () => {
    const result = requestApprovalRevisionSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decidedByUserId).toBe("board");
    }
  });

  it("accepts with note and userId", () => {
    expect(requestApprovalRevisionSchema.safeParse({
      decisionNote: "Please revise",
      decidedByUserId: "user-456",
    }).success).toBe(true);
  });
});

describe("resubmitApprovalSchema", () => {
  it("accepts empty object", () => {
    expect(resubmitApprovalSchema.safeParse({}).success).toBe(true);
  });

  it("accepts with payload", () => {
    expect(resubmitApprovalSchema.safeParse({ payload: { revised: true } }).success).toBe(true);
  });
});

describe("addApprovalCommentSchema", () => {
  it("accepts valid body", () => {
    expect(addApprovalCommentSchema.safeParse({ body: "This looks good!" }).success).toBe(true);
  });

  it("rejects empty body", () => {
    expect(addApprovalCommentSchema.safeParse({ body: "" }).success).toBe(false);
  });

  it("rejects missing body", () => {
    expect(addApprovalCommentSchema.safeParse({}).success).toBe(false);
  });
});
