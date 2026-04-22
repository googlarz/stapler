import { describe, it, expect } from "vitest";
import {
  issueWorkProductTypeSchema,
  issueWorkProductStatusSchema,
  issueWorkProductReviewStateSchema,
  createIssueWorkProductSchema,
  updateIssueWorkProductSchema,
} from "./work-product.js";

describe("issueWorkProductTypeSchema", () => {
  it("accepts valid types", () => {
    const validTypes = ["preview_url", "runtime_service", "pull_request", "branch", "commit", "artifact", "document"];
    for (const type of validTypes) {
      expect(issueWorkProductTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("rejects invalid type", () => {
    expect(issueWorkProductTypeSchema.safeParse("unknown").success).toBe(false);
  });
});

describe("issueWorkProductStatusSchema", () => {
  it("accepts valid statuses", () => {
    const validStatuses = ["active", "ready_for_review", "approved", "changes_requested", "merged", "closed", "failed", "archived", "draft"];
    for (const status of validStatuses) {
      expect(issueWorkProductStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    expect(issueWorkProductStatusSchema.safeParse("pending").success).toBe(false);
  });
});

describe("issueWorkProductReviewStateSchema", () => {
  it("accepts valid review states", () => {
    const validStates = ["none", "needs_board_review", "approved", "changes_requested"];
    for (const state of validStates) {
      expect(issueWorkProductReviewStateSchema.safeParse(state).success).toBe(true);
    }
  });
});

describe("createIssueWorkProductSchema", () => {
  const validInput = {
    type: "pull_request",
    provider: "github",
    title: "My PR",
  };

  it("accepts minimal valid input with defaults", () => {
    const result = createIssueWorkProductSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("active");
      expect(result.data.reviewState).toBe("none");
      expect(result.data.isPrimary).toBe(false);
      expect(result.data.healthStatus).toBe("unknown");
    }
  });

  it("accepts full valid input", () => {
    const result = createIssueWorkProductSchema.safeParse({
      ...validInput,
      projectId: "550e8400-e29b-41d4-a716-446655440000",
      executionWorkspaceId: "550e8400-e29b-41d4-a716-446655440001",
      runtimeServiceId: "550e8400-e29b-41d4-a716-446655440002",
      externalId: "123",
      url: "https://github.com/org/repo/pull/1",
      status: "merged",
      reviewState: "approved",
      isPrimary: true,
      healthStatus: "healthy",
      summary: "A summary",
      metadata: { key: "value" },
      createdByRunId: "550e8400-e29b-41d4-a716-446655440003",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    expect(createIssueWorkProductSchema.safeParse({ provider: "github", title: "t" }).success).toBe(false);
    expect(createIssueWorkProductSchema.safeParse({ type: "branch", title: "t" }).success).toBe(false);
    expect(createIssueWorkProductSchema.safeParse({ type: "branch", provider: "github" }).success).toBe(false);
  });

  it("rejects empty provider and title", () => {
    expect(createIssueWorkProductSchema.safeParse({ ...validInput, provider: "" }).success).toBe(false);
    expect(createIssueWorkProductSchema.safeParse({ ...validInput, title: "" }).success).toBe(false);
  });

  it("rejects invalid url", () => {
    expect(createIssueWorkProductSchema.safeParse({ ...validInput, url: "not-a-url" }).success).toBe(false);
  });

  it("rejects invalid uuid fields", () => {
    expect(createIssueWorkProductSchema.safeParse({ ...validInput, projectId: "not-uuid" }).success).toBe(false);
  });

  it("accepts null optional fields", () => {
    const result = createIssueWorkProductSchema.safeParse({
      ...validInput,
      projectId: null,
      url: null,
      summary: null,
      metadata: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("updateIssueWorkProductSchema", () => {
  it("accepts empty object (all fields optional)", () => {
    expect(updateIssueWorkProductSchema.safeParse({}).success).toBe(true);
  });

  it("accepts partial update", () => {
    expect(updateIssueWorkProductSchema.safeParse({ status: "merged" }).success).toBe(true);
  });
});
