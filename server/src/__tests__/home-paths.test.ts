/**
 * Tests for server home-paths helpers.
 */
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveDefaultAgentWorkspaceDir,
  resolveHomeAwarePath,
  resolveManagedProjectWorkspaceDir,
  resolvePaperclipHomeDir,
  resolvePaperclipInstanceId,
  resolvePaperclipInstanceRoot,
} from "../home-paths.js";

// Save/restore env for tests that modify it
let savedEnv: NodeJS.ProcessEnv;
beforeEach(() => {
  savedEnv = { ...process.env };
});
afterEach(() => {
  process.env = savedEnv;
});

// ──────────────────────────────────────────────────────────
// resolvePaperclipHomeDir
// ──────────────────────────────────────────────────────────

describe("resolvePaperclipHomeDir", () => {
  it("defaults to ~/.paperclip when STAPLER_HOME is unset", () => {
    delete process.env.STAPLER_HOME;
    const dir = resolvePaperclipHomeDir();
    expect(dir).toBe(path.resolve(os.homedir(), ".paperclip"));
  });

  it("respects STAPLER_HOME env var", () => {
    process.env.STAPLER_HOME = "/custom/home";
    expect(resolvePaperclipHomeDir()).toBe("/custom/home");
  });

  it("expands ~ in STAPLER_HOME", () => {
    process.env.STAPLER_HOME = "~/mypaperclip";
    const dir = resolvePaperclipHomeDir();
    expect(dir).toBe(path.resolve(os.homedir(), "mypaperclip"));
  });

  it("expands lone ~ to homedir", () => {
    process.env.STAPLER_HOME = "~";
    expect(resolvePaperclipHomeDir()).toBe(os.homedir());
  });
});

// ──────────────────────────────────────────────────────────
// resolvePaperclipInstanceId
// ──────────────────────────────────────────────────────────

describe("resolvePaperclipInstanceId", () => {
  it("defaults to 'default' when env var is unset", () => {
    delete process.env.STAPLER_INSTANCE_ID;
    expect(resolvePaperclipInstanceId()).toBe("default");
  });

  it("returns custom instance ID from env", () => {
    process.env.STAPLER_INSTANCE_ID = "production";
    expect(resolvePaperclipInstanceId()).toBe("production");
  });

  it("throws on instance ID with invalid characters", () => {
    process.env.STAPLER_INSTANCE_ID = "my instance!";
    expect(() => resolvePaperclipInstanceId()).toThrow(/Invalid STAPLER_INSTANCE_ID/);
  });

  it("allows hyphens and underscores", () => {
    process.env.STAPLER_INSTANCE_ID = "prod-us_east";
    expect(resolvePaperclipInstanceId()).toBe("prod-us_east");
  });
});

// ──────────────────────────────────────────────────────────
// resolvePaperclipInstanceRoot
// ──────────────────────────────────────────────────────────

describe("resolvePaperclipInstanceRoot", () => {
  it("includes instances/<instanceId> under the home dir", () => {
    delete process.env.STAPLER_HOME;
    delete process.env.STAPLER_INSTANCE_ID;
    const root = resolvePaperclipInstanceRoot();
    expect(root).toBe(
      path.resolve(os.homedir(), ".paperclip", "instances", "default"),
    );
  });
});

// ──────────────────────────────────────────────────────────
// resolveDefaultAgentWorkspaceDir
// ──────────────────────────────────────────────────────────

describe("resolveDefaultAgentWorkspaceDir", () => {
  it("returns workspace path with agentId", () => {
    delete process.env.STAPLER_HOME;
    delete process.env.STAPLER_INSTANCE_ID;
    const dir = resolveDefaultAgentWorkspaceDir("agent-123");
    expect(dir).toContain("workspaces");
    expect(dir).toContain("agent-123");
  });

  it("throws for agent ID with spaces", () => {
    expect(() => resolveDefaultAgentWorkspaceDir("bad id")).toThrow(/Invalid agent id/);
  });

  it("throws for agent ID with slashes", () => {
    expect(() => resolveDefaultAgentWorkspaceDir("../../etc")).toThrow(/Invalid agent id/);
  });

  it("allows UUID-like agent IDs with hyphens", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(() => resolveDefaultAgentWorkspaceDir(uuid)).not.toThrow();
  });
});

// ──────────────────────────────────────────────────────────
// resolveManagedProjectWorkspaceDir
// ──────────────────────────────────────────────────────────

describe("resolveManagedProjectWorkspaceDir", () => {
  it("includes company and project segments", () => {
    const dir = resolveManagedProjectWorkspaceDir({
      companyId: "my-company",
      projectId: "my-project",
    });
    expect(dir).toContain("projects");
    expect(dir).toContain("my-company");
    expect(dir).toContain("my-project");
  });

  it("uses repoName in path when provided", () => {
    const dir = resolveManagedProjectWorkspaceDir({
      companyId: "acme",
      projectId: "backend",
      repoName: "api-server",
    });
    expect(dir).toContain("api-server");
  });

  it("falls back to _default when repoName is null", () => {
    const dir = resolveManagedProjectWorkspaceDir({
      companyId: "acme",
      projectId: "backend",
      repoName: null,
    });
    expect(dir).toContain("_default");
  });

  it("sanitizes special characters in repoName", () => {
    const dir = resolveManagedProjectWorkspaceDir({
      companyId: "acme",
      projectId: "backend",
      repoName: "org/my repo name!",
    });
    // The last segment (repoName) should not contain special chars
    const lastSegment = path.basename(dir);
    expect(lastSegment).not.toContain("!");
    expect(lastSegment).not.toContain(" ");
  });

  it("throws when companyId is empty", () => {
    expect(() =>
      resolveManagedProjectWorkspaceDir({ companyId: "", projectId: "p1" }),
    ).toThrow(/companyId and projectId/);
  });

  it("throws when projectId is empty", () => {
    expect(() =>
      resolveManagedProjectWorkspaceDir({ companyId: "c1", projectId: "" }),
    ).toThrow(/companyId and projectId/);
  });
});

// ──────────────────────────────────────────────────────────
// resolveHomeAwarePath
// ──────────────────────────────────────────────────────────

describe("resolveHomeAwarePath", () => {
  it("expands ~ to homedir", () => {
    expect(resolveHomeAwarePath("~/projects")).toBe(
      path.resolve(os.homedir(), "projects"),
    );
  });

  it("resolves absolute paths unchanged", () => {
    expect(resolveHomeAwarePath("/var/data")).toBe("/var/data");
  });

  it("resolves relative paths against cwd", () => {
    const result = resolveHomeAwarePath("relative/path");
    expect(path.isAbsolute(result)).toBe(true);
  });
});
