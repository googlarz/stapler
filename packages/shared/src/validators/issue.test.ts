import { describe, expect, it } from "vitest";
import {
  addIssueCommentSchema,
  checkoutIssueSchema,
  createIssueLabelSchema,
  createIssueSchema,
  issueDocumentKeySchema,
  issueExecutionPolicySchema,
  issueExecutionStagePrincipalSchema,
  issueExecutionWorkspaceSettingsSchema,
  updateIssueSchema,
  upsertIssueDocumentSchema,
} from "./issue.js";

// ──────────────────────────────────────────────────────────
// createIssueSchema
// ──────────────────────────────────────────────────────────

describe("createIssueSchema", () => {
  const valid = { title: "Fix the bug" };

  it("accepts minimal valid issue", () => {
    const r = createIssueSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe("backlog");
      expect(r.data.priority).toBe("medium");
      expect(r.data.requestDepth).toBe(0);
    }
  });

  it("rejects empty title", () => {
    expect(createIssueSchema.safeParse({ ...valid, title: "" }).success).toBe(false);
  });

  it("rejects invalid status", () => {
    expect(createIssueSchema.safeParse({ ...valid, status: "archived" }).success).toBe(false);
  });

  it("accepts valid statuses", () => {
    for (const status of ["backlog", "todo", "in_progress", "done", "cancelled"]) {
      expect(createIssueSchema.safeParse({ ...valid, status }).success, `status=${status}`).toBe(true);
    }
  });

  it("rejects invalid priority", () => {
    expect(createIssueSchema.safeParse({ ...valid, priority: "urgent" }).success).toBe(false);
  });

  it("accepts valid priorities", () => {
    for (const priority of ["critical", "high", "medium", "low"]) {
      expect(createIssueSchema.safeParse({ ...valid, priority }).success, `priority=${priority}`).toBe(true);
    }
  });

  it("rejects non-UUID assigneeAgentId", () => {
    expect(createIssueSchema.safeParse({ ...valid, assigneeAgentId: "not-uuid" }).success).toBe(false);
  });

  it("accepts null assigneeAgentId", () => {
    expect(createIssueSchema.safeParse({ ...valid, assigneeAgentId: null }).success).toBe(true);
  });

  it("rejects non-UUID parentId", () => {
    expect(createIssueSchema.safeParse({ ...valid, parentId: "not-uuid" }).success).toBe(false);
  });

  it("accepts invalid-date scheduledFor string", () => {
    // The schema uses Date.parse which is lenient; "not-a-date" → NaN → rejected
    expect(createIssueSchema.safeParse({ ...valid, scheduledFor: "not-a-date" }).success).toBe(false);
  });

  it("accepts valid ISO scheduledFor", () => {
    expect(createIssueSchema.safeParse({ ...valid, scheduledFor: "2025-06-01T00:00:00Z" }).success).toBe(true);
  });

  it("rejects negative requestDepth", () => {
    expect(createIssueSchema.safeParse({ ...valid, requestDepth: -1 }).success).toBe(false);
  });

  it("accepts blockedByIssueIds array of UUIDs", () => {
    expect(createIssueSchema.safeParse({
      ...valid,
      blockedByIssueIds: ["550e8400-e29b-41d4-a716-446655440000"],
    }).success).toBe(true);
  });

  it("rejects non-UUID in blockedByIssueIds", () => {
    expect(createIssueSchema.safeParse({ ...valid, blockedByIssueIds: ["bad-id"] }).success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// updateIssueSchema
// ──────────────────────────────────────────────────────────

describe("updateIssueSchema", () => {
  it("accepts empty patch", () => {
    expect(updateIssueSchema.safeParse({}).success).toBe(true);
  });

  it("accepts reopen flag", () => {
    expect(updateIssueSchema.safeParse({ reopen: true }).success).toBe(true);
  });

  it("accepts comment field", () => {
    expect(updateIssueSchema.safeParse({ comment: "Updated the description" }).success).toBe(true);
  });

  it("rejects empty comment string", () => {
    expect(updateIssueSchema.safeParse({ comment: "" }).success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// issueExecutionStagePrincipalSchema
// ──────────────────────────────────────────────────────────

describe("issueExecutionStagePrincipalSchema", () => {
  it("accepts agent principal with agentId", () => {
    expect(issueExecutionStagePrincipalSchema.safeParse({
      type: "agent",
      agentId: "550e8400-e29b-41d4-a716-446655440000",
    }).success).toBe(true);
  });

  it("rejects agent principal without agentId", () => {
    expect(issueExecutionStagePrincipalSchema.safeParse({ type: "agent" }).success).toBe(false);
  });

  it("rejects agent principal with userId set", () => {
    expect(issueExecutionStagePrincipalSchema.safeParse({
      type: "agent",
      agentId: "550e8400-e29b-41d4-a716-446655440000",
      userId: "u1",
    }).success).toBe(false);
  });

  it("accepts user principal with userId", () => {
    expect(issueExecutionStagePrincipalSchema.safeParse({
      type: "user",
      userId: "user-123",
    }).success).toBe(true);
  });

  it("rejects user principal without userId", () => {
    expect(issueExecutionStagePrincipalSchema.safeParse({ type: "user" }).success).toBe(false);
  });

  it("rejects user principal with agentId set", () => {
    expect(issueExecutionStagePrincipalSchema.safeParse({
      type: "user",
      userId: "u1",
      agentId: "550e8400-e29b-41d4-a716-446655440000",
    }).success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// issueExecutionPolicySchema
// ──────────────────────────────────────────────────────────

describe("issueExecutionPolicySchema", () => {
  it("accepts empty object with defaults", () => {
    const r = issueExecutionPolicySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.mode).toBe("normal");
      expect(r.data.commentRequired).toBe(true);
      expect(r.data.stages).toEqual([]);
    }
  });

  it("accepts approval mode", () => {
    expect(issueExecutionPolicySchema.safeParse({ mode: "auto" }).success).toBe(true);
  });

  it("rejects unknown mode", () => {
    expect(issueExecutionPolicySchema.safeParse({ mode: "automatic" }).success).toBe(false);
  });

  it("accepts stages with agent participants", () => {
    const r = issueExecutionPolicySchema.safeParse({
      stages: [{
        type: "review",
        participants: [{ type: "agent", agentId: "550e8400-e29b-41d4-a716-446655440000" }],
      }],
    });
    expect(r.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// issueExecutionWorkspaceSettingsSchema
// ──────────────────────────────────────────────────────────

describe("issueExecutionWorkspaceSettingsSchema", () => {
  it("accepts empty object", () => {
    expect(issueExecutionWorkspaceSettingsSchema.safeParse({}).success).toBe(true);
  });

  it("accepts valid mode", () => {
    expect(issueExecutionWorkspaceSettingsSchema.safeParse({ mode: "isolated_workspace" }).success).toBe(true);
  });

  it("rejects invalid mode", () => {
    expect(issueExecutionWorkspaceSettingsSchema.safeParse({ mode: "cloud_only" }).success).toBe(false);
  });

  it("rejects unknown extra keys (strict)", () => {
    expect(issueExecutionWorkspaceSettingsSchema.safeParse({ unknownField: true }).success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// createIssueLabelSchema
// ──────────────────────────────────────────────────────────

describe("createIssueLabelSchema", () => {
  const valid = { name: "bug", color: "#ff0000" };

  it("accepts valid label", () => {
    expect(createIssueLabelSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(createIssueLabelSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("rejects name over 48 chars", () => {
    expect(createIssueLabelSchema.safeParse({ ...valid, name: "x".repeat(49) }).success).toBe(false);
  });

  it("rejects invalid color format", () => {
    expect(createIssueLabelSchema.safeParse({ ...valid, color: "red" }).success).toBe(false);
  });

  it("rejects 3-digit hex color", () => {
    expect(createIssueLabelSchema.safeParse({ ...valid, color: "#f00" }).success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// addIssueCommentSchema
// ──────────────────────────────────────────────────────────

describe("addIssueCommentSchema", () => {
  it("accepts valid comment body", () => {
    expect(addIssueCommentSchema.safeParse({ body: "Looks good!" }).success).toBe(true);
  });

  it("rejects empty body", () => {
    expect(addIssueCommentSchema.safeParse({ body: "" }).success).toBe(false);
  });

  it("accepts reopen and interrupt flags", () => {
    expect(addIssueCommentSchema.safeParse({
      body: "LGTM",
      reopen: true,
      interrupt: false,
    }).success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// checkoutIssueSchema
// ──────────────────────────────────────────────────────────

describe("checkoutIssueSchema", () => {
  it("accepts valid checkout request", () => {
    expect(checkoutIssueSchema.safeParse({
      agentId: "550e8400-e29b-41d4-a716-446655440000",
      expectedStatuses: ["todo"],
    }).success).toBe(true);
  });

  it("rejects non-UUID agentId", () => {
    expect(checkoutIssueSchema.safeParse({
      agentId: "not-uuid",
      expectedStatuses: ["todo"],
    }).success).toBe(false);
  });

  it("rejects empty expectedStatuses", () => {
    expect(checkoutIssueSchema.safeParse({
      agentId: "550e8400-e29b-41d4-a716-446655440000",
      expectedStatuses: [],
    }).success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// issueDocumentKeySchema
// ──────────────────────────────────────────────────────────

describe("issueDocumentKeySchema", () => {
  it("accepts valid document key", () => {
    expect(issueDocumentKeySchema.safeParse("spec-v1").success).toBe(true);
  });

  it("accepts key with numbers", () => {
    expect(issueDocumentKeySchema.safeParse("draft-2024").success).toBe(true);
  });

  it("rejects key starting with hyphen", () => {
    expect(issueDocumentKeySchema.safeParse("-bad").success).toBe(false);
  });

  it("rejects key with uppercase letters", () => {
    expect(issueDocumentKeySchema.safeParse("BadKey").success).toBe(false);
  });

  it("rejects empty key", () => {
    expect(issueDocumentKeySchema.safeParse("").success).toBe(false);
  });

  it("rejects key over 64 chars", () => {
    expect(issueDocumentKeySchema.safeParse("a".repeat(65)).success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// upsertIssueDocumentSchema
// ──────────────────────────────────────────────────────────

describe("upsertIssueDocumentSchema", () => {
  const valid = { format: "markdown", body: "# Hello" };

  it("accepts minimal valid document", () => {
    expect(upsertIssueDocumentSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid format", () => {
    expect(upsertIssueDocumentSchema.safeParse({ ...valid, format: "html" }).success).toBe(false);
  });

  it("rejects body over 524288 chars", () => {
    expect(upsertIssueDocumentSchema.safeParse({ ...valid, body: "x".repeat(524289) }).success).toBe(false);
  });

  it("rejects changeSummary over 500 chars", () => {
    expect(upsertIssueDocumentSchema.safeParse({
      ...valid,
      changeSummary: "x".repeat(501),
    }).success).toBe(false);
  });
});
