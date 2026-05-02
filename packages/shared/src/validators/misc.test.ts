/**
 * Tests for miscellaneous small validators:
 * feedback, cost, work-product, approval
 */
import { describe, expect, it } from "vitest";
import {
  addApprovalCommentSchema,
  createApprovalSchema,
  createCostEventSchema,
  createIssueWorkProductSchema,
  feedbackVoteValueSchema,
  issueWorkProductStatusSchema,
  issueWorkProductTypeSchema,
  resubmitApprovalSchema,
  resolveApprovalSchema,
  updateBudgetSchema,
  updateIssueWorkProductSchema,
  upsertIssueFeedbackVoteSchema,
} from "./index.js";

// ──────────────────────────────────────────────────────────
// upsertIssueFeedbackVoteSchema
// ──────────────────────────────────────────────────────────

describe("upsertIssueFeedbackVoteSchema", () => {
  const valid = {
    targetType: "issue_comment",
    targetId: "550e8400-e29b-41d4-a716-446655440000",
    vote: "up",
  };

  it("accepts minimal valid vote", () => {
    expect(upsertIssueFeedbackVoteSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects non-UUID targetId", () => {
    expect(upsertIssueFeedbackVoteSchema.safeParse({ ...valid, targetId: "bad" }).success).toBe(false);
  });

  it("rejects invalid vote value", () => {
    expect(upsertIssueFeedbackVoteSchema.safeParse({ ...valid, vote: "meh" }).success).toBe(false);
  });

  it("rejects reason over 1000 chars", () => {
    expect(upsertIssueFeedbackVoteSchema.safeParse({ ...valid, reason: "x".repeat(1001) }).success).toBe(false);
  });

  it("accepts reason up to 1000 chars", () => {
    expect(upsertIssueFeedbackVoteSchema.safeParse({ ...valid, reason: "x".repeat(1000) }).success).toBe(true);
  });
});

describe("feedbackVoteValueSchema", () => {
  it("accepts up", () => {
    expect(feedbackVoteValueSchema.safeParse("up").success).toBe(true);
  });

  it("accepts down", () => {
    expect(feedbackVoteValueSchema.safeParse("down").success).toBe(true);
  });

  it("rejects neutral", () => {
    expect(feedbackVoteValueSchema.safeParse("neutral").success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// createCostEventSchema
// ──────────────────────────────────────────────────────────

describe("createCostEventSchema", () => {
  const valid = {
    agentId: "550e8400-e29b-41d4-a716-446655440000",
    provider: "anthropic",
    model: "claude-3-opus",
    costCents: 100,
    occurredAt: new Date().toISOString(),
  };

  it("accepts minimal valid cost event", () => {
    const r = createCostEventSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.inputTokens).toBe(0);
      expect(r.data.outputTokens).toBe(0);
      expect(r.data.billingType).toBe("unknown");
      // biller defaults to provider when not set
      expect(r.data.biller).toBe("anthropic");
    }
  });

  it("rejects non-UUID agentId", () => {
    expect(createCostEventSchema.safeParse({ ...valid, agentId: "bad" }).success).toBe(false);
  });

  it("rejects empty provider", () => {
    expect(createCostEventSchema.safeParse({ ...valid, provider: "" }).success).toBe(false);
  });

  it("rejects negative costCents", () => {
    expect(createCostEventSchema.safeParse({ ...valid, costCents: -1 }).success).toBe(false);
  });

  it("rejects fractional costCents", () => {
    expect(createCostEventSchema.safeParse({ ...valid, costCents: 1.5 }).success).toBe(false);
  });

  it("rejects non-ISO occurredAt", () => {
    expect(createCostEventSchema.safeParse({ ...valid, occurredAt: "not-a-date" }).success).toBe(false);
  });

  it("uses explicit biller when provided", () => {
    const r = createCostEventSchema.safeParse({ ...valid, biller: "openrouter" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.biller).toBe("openrouter");
  });
});

describe("updateBudgetSchema", () => {
  it("accepts zero budget", () => {
    expect(updateBudgetSchema.safeParse({ budgetMonthlyCents: 0 }).success).toBe(true);
  });

  it("rejects negative budget", () => {
    expect(updateBudgetSchema.safeParse({ budgetMonthlyCents: -1 }).success).toBe(false);
  });

  it("rejects fractional budget", () => {
    expect(updateBudgetSchema.safeParse({ budgetMonthlyCents: 9.9 }).success).toBe(false);
  });

  it("rejects missing budget", () => {
    expect(updateBudgetSchema.safeParse({}).success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// createIssueWorkProductSchema
// ──────────────────────────────────────────────────────────

describe("createIssueWorkProductSchema", () => {
  const valid = {
    type: "pull_request",
    provider: "github",
    title: "Add feature X",
  };

  it("accepts minimal valid work product", () => {
    const r = createIssueWorkProductSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe("active");
      expect(r.data.reviewState).toBe("none");
      expect(r.data.isPrimary).toBe(false);
      expect(r.data.healthStatus).toBe("unknown");
    }
  });

  it("rejects invalid type", () => {
    expect(createIssueWorkProductSchema.safeParse({ ...valid, type: "wiki" }).success).toBe(false);
  });

  it("rejects empty title", () => {
    expect(createIssueWorkProductSchema.safeParse({ ...valid, title: "" }).success).toBe(false);
  });

  it("rejects invalid URL", () => {
    expect(createIssueWorkProductSchema.safeParse({ ...valid, url: "not-a-url" }).success).toBe(false);
  });

  it("accepts null URL", () => {
    expect(createIssueWorkProductSchema.safeParse({ ...valid, url: null }).success).toBe(true);
  });

  it("accepts valid URL", () => {
    expect(createIssueWorkProductSchema.safeParse({
      ...valid, url: "https://github.com/org/repo/pull/42",
    }).success).toBe(true);
  });
});

describe("issueWorkProductTypeSchema", () => {
  it("accepts all valid types", () => {
    for (const t of ["preview_url", "runtime_service", "pull_request", "branch", "commit", "artifact", "document"]) {
      expect(issueWorkProductTypeSchema.safeParse(t).success, `type=${t}`).toBe(true);
    }
  });

  it("rejects unknown type", () => {
    expect(issueWorkProductTypeSchema.safeParse("release").success).toBe(false);
  });
});

describe("issueWorkProductStatusSchema", () => {
  it("accepts active", () => {
    expect(issueWorkProductStatusSchema.safeParse("active").success).toBe(true);
  });

  it("accepts merged", () => {
    expect(issueWorkProductStatusSchema.safeParse("merged").success).toBe(true);
  });

  it("rejects deleted", () => {
    expect(issueWorkProductStatusSchema.safeParse("deleted").success).toBe(false);
  });
});

describe("updateIssueWorkProductSchema", () => {
  it("accepts empty patch", () => {
    expect(updateIssueWorkProductSchema.safeParse({}).success).toBe(true);
  });

  it("accepts partial status update", () => {
    expect(updateIssueWorkProductSchema.safeParse({ status: "merged" }).success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// approval schemas
// ──────────────────────────────────────────────────────────

describe("createApprovalSchema", () => {
  it("accepts valid approval", () => {
    expect(createApprovalSchema.safeParse({
      type: "hire_agent",
      payload: { agentName: "Bot" },
    }).success).toBe(true);
  });

  it("rejects invalid type", () => {
    expect(createApprovalSchema.safeParse({
      type: "unknown_type",
      payload: {},
    }).success).toBe(false);
  });

  it("rejects non-UUID requestedByAgentId", () => {
    expect(createApprovalSchema.safeParse({
      type: "hire_agent",
      payload: {},
      requestedByAgentId: "bad",
    }).success).toBe(false);
  });

  it("accepts null requestedByAgentId", () => {
    expect(createApprovalSchema.safeParse({
      type: "hire_agent",
      payload: {},
      requestedByAgentId: null,
    }).success).toBe(true);
  });
});

describe("resolveApprovalSchema", () => {
  it("accepts empty object", () => {
    const r = resolveApprovalSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("accepts decisionNote", () => {
    expect(resolveApprovalSchema.safeParse({ decisionNote: "Approved by CEO" }).success).toBe(true);
  });
});

describe("resubmitApprovalSchema", () => {
  it("accepts empty object", () => {
    expect(resubmitApprovalSchema.safeParse({}).success).toBe(true);
  });

  it("accepts payload override", () => {
    expect(resubmitApprovalSchema.safeParse({ payload: { reason: "revised" } }).success).toBe(true);
  });
});

describe("addApprovalCommentSchema", () => {
  it("accepts valid body", () => {
    expect(addApprovalCommentSchema.safeParse({ body: "LGTM" }).success).toBe(true);
  });

  it("rejects empty body", () => {
    expect(addApprovalCommentSchema.safeParse({ body: "" }).success).toBe(false);
  });
});
