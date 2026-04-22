import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";

// We mock fs.existsSync so tests don't depend on real filesystem layout.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(() => false) };
});

// Import after mocking
const { resolveRuntimeLikePath } = await import("./path-resolver.js");
const fs = await import("node:fs");
const existsSyncMock = fs.existsSync as unknown as ReturnType<typeof vi.fn>;

describe("resolveRuntimeLikePath", () => {
  beforeEach(() => {
    existsSyncMock.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("absolute paths", () => {
    it("returns the resolved absolute path as-is", () => {
      const abs = "/tmp/some/path";
      const result = resolveRuntimeLikePath(abs);
      expect(result).toBe(path.resolve(abs));
    });

    it("resolves ~ to home directory", () => {
      const result = resolveRuntimeLikePath("~/mydir");
      expect(result).toBe(path.resolve(os.homedir(), "mydir"));
    });

    it("resolves bare ~ to home directory", () => {
      const result = resolveRuntimeLikePath("~");
      expect(result).toBe(os.homedir());
    });
  });

  describe("relative paths without configPath", () => {
    it("falls back to first candidate (workspaceRoot/server/value) when nothing exists", () => {
      const cwd = process.cwd();
      const result = resolveRuntimeLikePath("dist/index.js");
      // Without configPath, workspaceRoot === cwd; first candidate is cwd/server/dist/index.js
      expect(result).toBe(path.resolve(cwd, "server", "dist/index.js"));
    });

    it("returns the existing candidate when one exists", () => {
      existsSyncMock.mockImplementation((p: string) => p.endsWith("dist/index.js") && !p.includes("server"));
      const cwd = process.cwd();
      const result = resolveRuntimeLikePath("dist/index.js");
      expect(result).toBe(path.resolve(cwd, "dist/index.js"));
    });
  });

  describe("relative paths with configPath", () => {
    it("prefers configDir-relative path when it exists", () => {
      const configPath = "/workspace/config/stapler.json";
      const configDir = "/workspace/config";
      existsSyncMock.mockImplementation((p: string) => p === path.resolve(configDir, "runtime/index.js"));
      const result = resolveRuntimeLikePath("runtime/index.js", configPath);
      expect(result).toBe(path.resolve(configDir, "runtime/index.js"));
    });

    it("falls back to workspaceRoot candidate when configDir candidate does not exist", () => {
      const configPath = "/workspace/config/stapler.json";
      const workspaceRoot = "/workspace";
      existsSyncMock.mockImplementation((p: string) => p === path.resolve(workspaceRoot, "server", "runtime/index.js"));
      const result = resolveRuntimeLikePath("runtime/index.js", configPath);
      expect(result).toBe(path.resolve(workspaceRoot, "server", "runtime/index.js"));
    });

    it("returns first candidate when nothing exists (configDir-relative)", () => {
      const configPath = "/workspace/config/stapler.json";
      const configDir = "/workspace/config";
      const result = resolveRuntimeLikePath("myfile.js", configPath);
      expect(result).toBe(path.resolve(configDir, "myfile.js"));
    });
  });

  describe("deduplication of candidates", () => {
    it("does not error when cwd equals workspaceRoot (duplicate candidates are deduplicated)", () => {
      // This exercises the unique() helper — should not throw
      expect(() => resolveRuntimeLikePath("something.js")).not.toThrow();
    });
  });
});
