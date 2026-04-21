/**
 * Tests for execution workspace validators.
 */
import { describe, expect, it } from "vitest";
import {
  executionWorkspaceConfigSchema,
  executionWorkspaceStatusSchema,
  updateExecutionWorkspaceSchema,
} from "./execution-workspace.js";

// ──────────────────────────────────────────────────────────
// executionWorkspaceStatusSchema
// ──────────────────────────────────────────────────────────

describe("executionWorkspaceStatusSchema", () => {
  it("accepts active", () => {
    expect(executionWorkspaceStatusSchema.safeParse("active").success).toBe(true);
  });

  it("accepts idle", () => {
    expect(executionWorkspaceStatusSchema.safeParse("idle").success).toBe(true);
  });

  it("accepts archived", () => {
    expect(executionWorkspaceStatusSchema.safeParse("archived").success).toBe(true);
  });

  it("accepts in_review", () => {
    expect(executionWorkspaceStatusSchema.safeParse("in_review").success).toBe(true);
  });

  it("accepts cleanup_failed", () => {
    expect(executionWorkspaceStatusSchema.safeParse("cleanup_failed").success).toBe(true);
  });

  it("rejects unknown status", () => {
    expect(executionWorkspaceStatusSchema.safeParse("deleted").success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// executionWorkspaceConfigSchema
// ──────────────────────────────────────────────────────────

describe("executionWorkspaceConfigSchema", () => {
  it("accepts empty object", () => {
    expect(executionWorkspaceConfigSchema.safeParse({}).success).toBe(true);
  });

  it("accepts full config with all optional fields", () => {
    expect(
      executionWorkspaceConfigSchema.safeParse({
        provisionCommand: "make setup",
        teardownCommand: "make clean",
        cleanupCommand: "make cleanup",
        workspaceRuntime: { type: "docker" },
        desiredState: "running",
      }).success,
    ).toBe(true);
  });

  it("rejects unknown key (strict)", () => {
    expect(
      executionWorkspaceConfigSchema.safeParse({ unknownField: "foo" }).success,
    ).toBe(false);
  });

  it("accepts desiredState=stopped", () => {
    expect(
      executionWorkspaceConfigSchema.safeParse({ desiredState: "stopped" }).success,
    ).toBe(true);
  });

  it("rejects invalid desiredState", () => {
    expect(
      executionWorkspaceConfigSchema.safeParse({ desiredState: "paused" }).success,
    ).toBe(false);
  });

  it("accepts null for all nullable fields", () => {
    expect(
      executionWorkspaceConfigSchema.safeParse({
        provisionCommand: null,
        teardownCommand: null,
        cleanupCommand: null,
        workspaceRuntime: null,
        desiredState: null,
      }).success,
    ).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// updateExecutionWorkspaceSchema
// ──────────────────────────────────────────────────────────

describe("updateExecutionWorkspaceSchema", () => {
  it("accepts empty patch (all optional)", () => {
    expect(updateExecutionWorkspaceSchema.safeParse({}).success).toBe(true);
  });

  it("accepts status update", () => {
    expect(
      updateExecutionWorkspaceSchema.safeParse({ status: "archived" }).success,
    ).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(
      updateExecutionWorkspaceSchema.safeParse({ status: "removed" }).success,
    ).toBe(false);
  });

  it("accepts cleanupEligibleAt as ISO datetime", () => {
    expect(
      updateExecutionWorkspaceSchema.safeParse({
        cleanupEligibleAt: new Date().toISOString(),
      }).success,
    ).toBe(true);
  });

  it("rejects cleanupEligibleAt as non-ISO string", () => {
    expect(
      updateExecutionWorkspaceSchema.safeParse({ cleanupEligibleAt: "tomorrow" }).success,
    ).toBe(false);
  });

  it("accepts nested config update", () => {
    expect(
      updateExecutionWorkspaceSchema.safeParse({
        config: { desiredState: "stopped" },
      }).success,
    ).toBe(true);
  });

  it("rejects unknown key (strict)", () => {
    expect(
      updateExecutionWorkspaceSchema.safeParse({ randomField: true }).success,
    ).toBe(false);
  });

  it("accepts null config", () => {
    expect(
      updateExecutionWorkspaceSchema.safeParse({ config: null }).success,
    ).toBe(true);
  });

  it("accepts name update", () => {
    expect(
      updateExecutionWorkspaceSchema.safeParse({ name: "my-workspace" }).success,
    ).toBe(true);
  });

  it("rejects empty name", () => {
    expect(
      updateExecutionWorkspaceSchema.safeParse({ name: "" }).success,
    ).toBe(false);
  });
});
