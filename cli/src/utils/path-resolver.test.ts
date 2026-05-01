import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { resolveRuntimeLikePath } from "./path-resolver.js";

const noExist = () => false;

describe("resolveRuntimeLikePath", () => {
  describe("absolute paths", () => {
    it("returns the resolved absolute path as-is", () => {
      const abs = "/tmp/some/path";
      const result = resolveRuntimeLikePath(abs, undefined, noExist);
      expect(result).toBe(path.resolve(abs));
    });

    it("resolves ~ to home directory", () => {
      const result = resolveRuntimeLikePath("~/mydir", undefined, noExist);
      expect(result).toBe(path.resolve(os.homedir(), "mydir"));
    });

    it("resolves bare ~ to home directory", () => {
      const result = resolveRuntimeLikePath("~", undefined, noExist);
      expect(result).toBe(os.homedir());
    });
  });

  describe("relative paths without configPath", () => {
    it("falls back to first candidate (workspaceRoot/server/value) when nothing exists", () => {
      const cwd = process.cwd();
      const result = resolveRuntimeLikePath("dist/index.js", undefined, noExist);
      // Without configPath, workspaceRoot === cwd; first candidate is cwd/server/dist/index.js
      expect(result).toBe(path.resolve(cwd, "server", "dist/index.js"));
    });

    it("returns the existing candidate when one exists", () => {
      const cwd = process.cwd();
      const existsSync = (p: string) => p.endsWith("dist/index.js") && !p.includes("server");
      const result = resolveRuntimeLikePath("dist/index.js", undefined, existsSync);
      expect(result).toBe(path.resolve(cwd, "dist/index.js"));
    });
  });

  describe("relative paths with configPath", () => {
    it("prefers configDir-relative path when it exists", () => {
      const configPath = "/workspace/config/stapler.json";
      const configDir = "/workspace/config";
      const existsSync = (p: string) => p === path.resolve(configDir, "runtime/index.js");
      const result = resolveRuntimeLikePath("runtime/index.js", configPath, existsSync);
      expect(result).toBe(path.resolve(configDir, "runtime/index.js"));
    });

    it("falls back to workspaceRoot candidate when configDir candidate does not exist", () => {
      const configPath = "/workspace/config/stapler.json";
      const workspaceRoot = "/workspace";
      const existsSync = (p: string) => p === path.resolve(workspaceRoot, "server", "runtime/index.js");
      const result = resolveRuntimeLikePath("runtime/index.js", configPath, existsSync);
      expect(result).toBe(path.resolve(workspaceRoot, "server", "runtime/index.js"));
    });

    it("returns first candidate when nothing exists (configDir-relative)", () => {
      const configPath = "/workspace/config/stapler.json";
      const configDir = "/workspace/config";
      const result = resolveRuntimeLikePath("myfile.js", configPath, noExist);
      expect(result).toBe(path.resolve(configDir, "myfile.js"));
    });
  });

  describe("deduplication of candidates", () => {
    it("does not error when cwd equals workspaceRoot (duplicate candidates are deduplicated)", () => {
      // This exercises the unique() helper — should not throw
      expect(() => resolveRuntimeLikePath("something.js", undefined, noExist)).not.toThrow();
    });
  });
});
