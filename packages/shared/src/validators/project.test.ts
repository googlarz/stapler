import { describe, expect, it } from "vitest";
import {
  createProjectSchema,
  createProjectWorkspaceSchema,
  projectExecutionWorkspacePolicySchema,
  updateProjectSchema,
  updateProjectWorkspaceSchema,
} from "./project.js";

// ──────────────────────────────────────────────────────────
// createProjectSchema
// ──────────────────────────────────────────────────────────

describe("createProjectSchema", () => {
  const valid = { name: "My Project" };

  it("accepts minimal valid project", () => {
    const r = createProjectSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.status).toBe("backlog");
  });

  it("rejects empty name", () => {
    expect(createProjectSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("rejects invalid status", () => {
    expect(createProjectSchema.safeParse({ ...valid, status: "deleted" }).success).toBe(false);
  });

  it("accepts valid statuses", () => {
    for (const status of ["backlog", "planned", "in_progress", "completed", "cancelled"]) {
      const r = createProjectSchema.safeParse({ ...valid, status });
      expect(r.success, `status=${status}`).toBe(true);
    }
  });

  it("rejects non-UUID leadAgentId", () => {
    expect(createProjectSchema.safeParse({ ...valid, leadAgentId: "not-uuid" }).success).toBe(false);
  });

  it("accepts null leadAgentId", () => {
    expect(createProjectSchema.safeParse({ ...valid, leadAgentId: null }).success).toBe(true);
  });

  it("rejects non-UUID in goalIds", () => {
    expect(createProjectSchema.safeParse({ ...valid, goalIds: ["bad-id"] }).success).toBe(false);
  });

  it("accepts empty goalIds", () => {
    expect(createProjectSchema.safeParse({ ...valid, goalIds: [] }).success).toBe(true);
  });

  it("validates env via envConfigSchema", () => {
    const withBadEnv = { ...valid, env: { KEY: { type: "bad", value: "v" } } };
    expect(createProjectSchema.safeParse(withBadEnv).success).toBe(false);
  });

  it("accepts env with plain string binding", () => {
    expect(createProjectSchema.safeParse({ ...valid, env: { KEY: "value" } }).success).toBe(true);
  });

  it("accepts workspace with cwd", () => {
    const r = createProjectSchema.safeParse({
      ...valid,
      workspace: { cwd: "/some/path" },
    });
    expect(r.success).toBe(true);
  });

  it("requires workspace to have cwd or repoUrl", () => {
    const r = createProjectSchema.safeParse({
      ...valid,
      workspace: { name: "ws without location" },
    });
    expect(r.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// updateProjectSchema
// ──────────────────────────────────────────────────────────

describe("updateProjectSchema", () => {
  it("accepts empty patch", () => {
    expect(updateProjectSchema.safeParse({}).success).toBe(true);
  });

  it("accepts partial name update", () => {
    expect(updateProjectSchema.safeParse({ name: "New Name" }).success).toBe(true);
  });

  it("rejects empty name in update", () => {
    expect(updateProjectSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// createProjectWorkspaceSchema
// ──────────────────────────────────────────────────────────

describe("createProjectWorkspaceSchema", () => {
  it("accepts workspace with cwd", () => {
    expect(createProjectWorkspaceSchema.safeParse({ cwd: "/home/agent/project" }).success).toBe(true);
  });

  it("accepts workspace with repoUrl", () => {
    expect(createProjectWorkspaceSchema.safeParse({
      repoUrl: "https://github.com/org/repo",
    }).success).toBe(true);
  });

  it("rejects workspace with neither cwd nor repoUrl", () => {
    expect(createProjectWorkspaceSchema.safeParse({ name: "orphan" }).success).toBe(false);
  });

  it("accepts remote_managed with remoteWorkspaceRef", () => {
    expect(createProjectWorkspaceSchema.safeParse({
      sourceType: "remote_managed",
      remoteWorkspaceRef: "ref-123",
    }).success).toBe(true);
  });

  it("rejects remote_managed without remoteWorkspaceRef or repoUrl", () => {
    expect(createProjectWorkspaceSchema.safeParse({
      sourceType: "remote_managed",
    }).success).toBe(false);
  });

  it("defaults isPrimary to false", () => {
    const r = createProjectWorkspaceSchema.safeParse({ cwd: "/path" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.isPrimary).toBe(false);
  });

  it("accepts valid sourceType values", () => {
    for (const sourceType of ["local_path", "git_repo", "remote_managed", "non_git_path"] as const) {
      const input = sourceType === "remote_managed"
        ? { sourceType, remoteWorkspaceRef: "ref" }
        : { sourceType, cwd: "/path" };
      expect(createProjectWorkspaceSchema.safeParse(input).success, `sourceType=${sourceType}`).toBe(true);
    }
  });
});

// ──────────────────────────────────────────────────────────
// updateProjectWorkspaceSchema (partial — no superRefine)
// ──────────────────────────────────────────────────────────

describe("updateProjectWorkspaceSchema", () => {
  it("accepts empty patch", () => {
    expect(updateProjectWorkspaceSchema.safeParse({}).success).toBe(true);
  });

  it("accepts partial cwd update", () => {
    expect(updateProjectWorkspaceSchema.safeParse({ cwd: "/new/path" }).success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// projectExecutionWorkspacePolicySchema
// ──────────────────────────────────────────────────────────

describe("projectExecutionWorkspacePolicySchema", () => {
  it("accepts minimal valid policy with enabled flag", () => {
    expect(projectExecutionWorkspacePolicySchema.safeParse({ enabled: true }).success).toBe(true);
  });

  it("rejects missing enabled", () => {
    expect(projectExecutionWorkspacePolicySchema.safeParse({}).success).toBe(false);
  });

  it("accepts valid defaultMode", () => {
    expect(projectExecutionWorkspacePolicySchema.safeParse({
      enabled: false,
      defaultMode: "isolated_workspace",
    }).success).toBe(true);
  });

  it("rejects invalid defaultMode", () => {
    expect(projectExecutionWorkspacePolicySchema.safeParse({
      enabled: true,
      defaultMode: "cloud_only",
    }).success).toBe(false);
  });

  it("rejects unknown extra keys (strict)", () => {
    expect(projectExecutionWorkspacePolicySchema.safeParse({
      enabled: true,
      unknownKey: "nope",
    }).success).toBe(false);
  });
});
