import { describe, expect, it } from "vitest";
import {
  getClosedIsolatedExecutionWorkspaceMessage,
  isClosedIsolatedExecutionWorkspace,
} from "./execution-workspace-guards.js";

describe("isClosedIsolatedExecutionWorkspace", () => {
  const base = {
    mode: "isolated_workspace" as const,
    status: "active" as const,
    closedAt: null,
    name: "ws-1",
  };

  it("returns false for null", () => {
    expect(isClosedIsolatedExecutionWorkspace(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isClosedIsolatedExecutionWorkspace(undefined)).toBe(false);
  });

  it("returns false for active isolated workspace with no closedAt", () => {
    expect(isClosedIsolatedExecutionWorkspace(base)).toBe(false);
  });

  it("returns true when closedAt is set", () => {
    expect(
      isClosedIsolatedExecutionWorkspace({ ...base, closedAt: new Date() }),
    ).toBe(true);
  });

  it("returns true when status is archived", () => {
    expect(
      isClosedIsolatedExecutionWorkspace({ ...base, status: "archived" }),
    ).toBe(true);
  });

  it("returns true when status is cleanup_failed", () => {
    expect(
      isClosedIsolatedExecutionWorkspace({ ...base, status: "cleanup_failed" }),
    ).toBe(true);
  });

  it("returns false for non-isolated_workspace mode even with closedAt", () => {
    expect(
      isClosedIsolatedExecutionWorkspace({
        ...base,
        mode: "shared_workspace",
        closedAt: new Date(),
      }),
    ).toBe(false);
  });

  it("returns false for shared_workspace mode with archived status", () => {
    expect(
      isClosedIsolatedExecutionWorkspace({
        ...base,
        mode: "shared_workspace",
        status: "archived",
      }),
    ).toBe(false);
  });
});

describe("getClosedIsolatedExecutionWorkspaceMessage", () => {
  it("includes workspace name in message", () => {
    const msg = getClosedIsolatedExecutionWorkspaceMessage({ name: "my-branch-ws" });
    expect(msg).toContain("my-branch-ws");
  });

  it("advises moving the issue before resuming work", () => {
    const msg = getClosedIsolatedExecutionWorkspaceMessage({ name: "ws" });
    expect(msg.toLowerCase()).toContain("workspace");
  });
});
