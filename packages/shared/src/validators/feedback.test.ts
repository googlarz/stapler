import { describe, it, expect } from "vitest";
import {
  feedbackTargetTypeSchema,
  feedbackTraceStatusSchema,
  feedbackVoteValueSchema,
  feedbackDataSharingPreferenceSchema,
  upsertIssueFeedbackVoteSchema,
} from "./feedback.js";

describe("feedbackTargetTypeSchema", () => {
  it("accepts valid target types", () => {
    expect(feedbackTargetTypeSchema.safeParse("issue_comment").success).toBe(true);
    expect(feedbackTargetTypeSchema.safeParse("issue_document_revision").success).toBe(true);
  });

  it("rejects invalid type", () => {
    expect(feedbackTargetTypeSchema.safeParse("issue_run").success).toBe(false);
  });
});

describe("feedbackTraceStatusSchema", () => {
  it("accepts valid statuses", () => {
    for (const status of ["local_only", "pending", "sent", "failed"]) {
      expect(feedbackTraceStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    expect(feedbackTraceStatusSchema.safeParse("unknown").success).toBe(false);
  });
});

describe("feedbackVoteValueSchema", () => {
  it("accepts up and down", () => {
    expect(feedbackVoteValueSchema.safeParse("up").success).toBe(true);
    expect(feedbackVoteValueSchema.safeParse("down").success).toBe(true);
  });

  it("rejects other values", () => {
    expect(feedbackVoteValueSchema.safeParse("neutral").success).toBe(false);
  });
});

describe("feedbackDataSharingPreferenceSchema", () => {
  it("accepts valid preferences", () => {
    for (const pref of ["allowed", "not_allowed", "prompt"]) {
      expect(feedbackDataSharingPreferenceSchema.safeParse(pref).success).toBe(true);
    }
  });

  it("rejects invalid preference", () => {
    expect(feedbackDataSharingPreferenceSchema.safeParse("denied").success).toBe(false);
  });
});

describe("upsertIssueFeedbackVoteSchema", () => {
  const validInput = {
    targetType: "issue_comment",
    targetId: "550e8400-e29b-41d4-a716-446655440000",
    vote: "up",
  };

  it("accepts minimal valid input", () => {
    expect(upsertIssueFeedbackVoteSchema.safeParse(validInput).success).toBe(true);
  });

  it("accepts with optional reason and allowSharing", () => {
    expect(upsertIssueFeedbackVoteSchema.safeParse({
      ...validInput,
      reason: "This was very helpful",
      allowSharing: true,
    }).success).toBe(true);
  });

  it("trims reason", () => {
    const result = upsertIssueFeedbackVoteSchema.safeParse({
      ...validInput,
      reason: "  great job  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBe("great job");
    }
  });

  it("rejects reason exceeding 1000 chars", () => {
    expect(upsertIssueFeedbackVoteSchema.safeParse({
      ...validInput,
      reason: "a".repeat(1001),
    }).success).toBe(false);
  });

  it("rejects invalid targetId uuid", () => {
    expect(upsertIssueFeedbackVoteSchema.safeParse({ ...validInput, targetId: "not-uuid" }).success).toBe(false);
  });

  it("rejects invalid vote value", () => {
    expect(upsertIssueFeedbackVoteSchema.safeParse({ ...validInput, vote: "meh" }).success).toBe(false);
  });

  it("rejects invalid targetType", () => {
    expect(upsertIssueFeedbackVoteSchema.safeParse({ ...validInput, targetType: "run" }).success).toBe(false);
  });

  it("rejects missing required fields", () => {
    expect(upsertIssueFeedbackVoteSchema.safeParse({ vote: "up" }).success).toBe(false);
    expect(upsertIssueFeedbackVoteSchema.safeParse({ targetType: "issue_comment", targetId: "550e8400-e29b-41d4-a716-446655440000" }).success).toBe(false);
  });
});
