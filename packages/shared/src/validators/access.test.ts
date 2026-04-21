/**
 * Tests for access/invite/join validators.
 */
import { describe, expect, it } from "vitest";
import {
  acceptInviteSchema,
  boardCliAuthAccessLevelSchema,
  claimJoinRequestApiKeySchema,
  createCliAuthChallengeSchema,
  createCompanyInviteSchema,
  createOpenClawInvitePromptSchema,
  listJoinRequestsQuerySchema,
  resolveCliAuthChallengeSchema,
  updateMemberPermissionsSchema,
  updateUserCompanyAccessSchema,
} from "./index.js";

// ──────────────────────────────────────────────────────────
// createCompanyInviteSchema
// ──────────────────────────────────────────────────────────

describe("createCompanyInviteSchema", () => {
  it("accepts minimal valid invite (empty object uses defaults)", () => {
    const r = createCompanyInviteSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.allowedJoinTypes).toBe("both");
  });

  it("accepts explicit allowedJoinTypes=human", () => {
    expect(createCompanyInviteSchema.safeParse({ allowedJoinTypes: "human" }).success).toBe(true);
  });

  it("accepts explicit allowedJoinTypes=agent", () => {
    expect(createCompanyInviteSchema.safeParse({ allowedJoinTypes: "agent" }).success).toBe(true);
  });

  it("rejects unknown allowedJoinTypes", () => {
    expect(createCompanyInviteSchema.safeParse({ allowedJoinTypes: "admin" }).success).toBe(false);
  });

  it("accepts agentMessage up to 4000 chars", () => {
    expect(
      createCompanyInviteSchema.safeParse({ agentMessage: "x".repeat(4000) }).success,
    ).toBe(true);
  });

  it("rejects agentMessage over 4000 chars", () => {
    expect(
      createCompanyInviteSchema.safeParse({ agentMessage: "x".repeat(4001) }).success,
    ).toBe(false);
  });

  it("accepts defaultsPayload as arbitrary key-value record", () => {
    expect(
      createCompanyInviteSchema.safeParse({ defaultsPayload: { url: "http://x.com", flag: true } })
        .success,
    ).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// createOpenClawInvitePromptSchema
// ──────────────────────────────────────────────────────────

describe("createOpenClawInvitePromptSchema", () => {
  it("accepts empty object", () => {
    expect(createOpenClawInvitePromptSchema.safeParse({}).success).toBe(true);
  });

  it("accepts null agentMessage", () => {
    expect(createOpenClawInvitePromptSchema.safeParse({ agentMessage: null }).success).toBe(true);
  });

  it("rejects agentMessage over 4000 chars", () => {
    expect(
      createOpenClawInvitePromptSchema.safeParse({ agentMessage: "y".repeat(4001) }).success,
    ).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// acceptInviteSchema
// ──────────────────────────────────────────────────────────

describe("acceptInviteSchema", () => {
  const valid = { requestType: "agent" };

  it("accepts minimal valid acceptance", () => {
    expect(acceptInviteSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid requestType", () => {
    expect(acceptInviteSchema.safeParse({ requestType: "guest" }).success).toBe(false);
  });

  it("accepts human requestType", () => {
    expect(acceptInviteSchema.safeParse({ requestType: "human" }).success).toBe(true);
  });

  it("accepts optional agentName up to 120 chars", () => {
    expect(
      acceptInviteSchema.safeParse({ ...valid, agentName: "a".repeat(120) }).success,
    ).toBe(true);
  });

  it("rejects agentName over 120 chars", () => {
    expect(
      acceptInviteSchema.safeParse({ ...valid, agentName: "a".repeat(121) }).success,
    ).toBe(false);
  });

  it("accepts null paperclipApiUrl", () => {
    expect(acceptInviteSchema.safeParse({ ...valid, paperclipApiUrl: null }).success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// listJoinRequestsQuerySchema
// ──────────────────────────────────────────────────────────

describe("listJoinRequestsQuerySchema", () => {
  it("accepts empty query", () => {
    expect(listJoinRequestsQuerySchema.safeParse({}).success).toBe(true);
  });

  it("accepts valid status=pending_approval", () => {
    expect(listJoinRequestsQuerySchema.safeParse({ status: "pending_approval" }).success).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(listJoinRequestsQuerySchema.safeParse({ status: "open" }).success).toBe(false);
  });

  it("accepts requestType=human", () => {
    expect(listJoinRequestsQuerySchema.safeParse({ requestType: "human" }).success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// claimJoinRequestApiKeySchema
// ──────────────────────────────────────────────────────────

describe("claimJoinRequestApiKeySchema", () => {
  it("accepts a 16-char claimSecret", () => {
    expect(
      claimJoinRequestApiKeySchema.safeParse({ claimSecret: "a".repeat(16) }).success,
    ).toBe(true);
  });

  it("rejects claimSecret shorter than 16 chars", () => {
    expect(
      claimJoinRequestApiKeySchema.safeParse({ claimSecret: "short" }).success,
    ).toBe(false);
  });

  it("rejects claimSecret longer than 256 chars", () => {
    expect(
      claimJoinRequestApiKeySchema.safeParse({ claimSecret: "a".repeat(257) }).success,
    ).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// boardCliAuthAccessLevelSchema
// ──────────────────────────────────────────────────────────

describe("boardCliAuthAccessLevelSchema", () => {
  it("accepts board", () => {
    expect(boardCliAuthAccessLevelSchema.safeParse("board").success).toBe(true);
  });

  it("accepts instance_admin_required", () => {
    expect(boardCliAuthAccessLevelSchema.safeParse("instance_admin_required").success).toBe(true);
  });

  it("rejects unknown level", () => {
    expect(boardCliAuthAccessLevelSchema.safeParse("super_admin").success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// createCliAuthChallengeSchema
// ──────────────────────────────────────────────────────────

describe("createCliAuthChallengeSchema", () => {
  const valid = { command: "stapler login" };

  it("accepts minimal valid challenge", () => {
    const r = createCliAuthChallengeSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.requestedAccess).toBe("board");
  });

  it("rejects empty command", () => {
    expect(createCliAuthChallengeSchema.safeParse({ command: "" }).success).toBe(false);
  });

  it("rejects command over 240 chars", () => {
    expect(
      createCliAuthChallengeSchema.safeParse({ command: "c".repeat(241) }).success,
    ).toBe(false);
  });

  it("accepts instance_admin_required access level", () => {
    expect(
      createCliAuthChallengeSchema.safeParse({
        ...valid,
        requestedAccess: "instance_admin_required",
      }).success,
    ).toBe(true);
  });

  it("accepts requestedCompanyId as UUID", () => {
    expect(
      createCliAuthChallengeSchema.safeParse({
        ...valid,
        requestedCompanyId: "550e8400-e29b-41d4-a716-446655440000",
      }).success,
    ).toBe(true);
  });

  it("rejects requestedCompanyId as non-UUID", () => {
    expect(
      createCliAuthChallengeSchema.safeParse({ ...valid, requestedCompanyId: "not-uuid" }).success,
    ).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// resolveCliAuthChallengeSchema
// ──────────────────────────────────────────────────────────

describe("resolveCliAuthChallengeSchema", () => {
  it("accepts a 16-char token", () => {
    expect(resolveCliAuthChallengeSchema.safeParse({ token: "a".repeat(16) }).success).toBe(true);
  });

  it("rejects token shorter than 16 chars", () => {
    expect(resolveCliAuthChallengeSchema.safeParse({ token: "tiny" }).success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// updateMemberPermissionsSchema
// ──────────────────────────────────────────────────────────

describe("updateMemberPermissionsSchema", () => {
  it("accepts empty grants array", () => {
    expect(updateMemberPermissionsSchema.safeParse({ grants: [] }).success).toBe(true);
  });

  it("accepts grant with valid permissionKey", () => {
    expect(
      updateMemberPermissionsSchema.safeParse({
        grants: [{ permissionKey: "tasks:assign" }],
      }).success,
    ).toBe(true);
  });

  it("rejects grant with invalid permissionKey", () => {
    expect(
      updateMemberPermissionsSchema.safeParse({
        grants: [{ permissionKey: "superpower:all" }],
      }).success,
    ).toBe(false);
  });

  it("rejects missing grants", () => {
    expect(updateMemberPermissionsSchema.safeParse({}).success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// updateUserCompanyAccessSchema
// ──────────────────────────────────────────────────────────

describe("updateUserCompanyAccessSchema", () => {
  it("defaults to empty companyIds array", () => {
    const r = updateUserCompanyAccessSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.companyIds).toEqual([]);
  });

  it("accepts array of UUID companyIds", () => {
    expect(
      updateUserCompanyAccessSchema.safeParse({
        companyIds: ["550e8400-e29b-41d4-a716-446655440000"],
      }).success,
    ).toBe(true);
  });

  it("rejects companyIds with non-UUID entry", () => {
    expect(
      updateUserCompanyAccessSchema.safeParse({ companyIds: ["not-a-uuid"] }).success,
    ).toBe(false);
  });
});
