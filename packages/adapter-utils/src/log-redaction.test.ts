import { describe, expect, it } from "vitest";
import {
  redactHomePathUserSegments,
  redactHomePathUserSegmentsInValue,
} from "./log-redaction.js";

describe("redactHomePathUserSegments", () => {
  it("redacts /Users/<name> on macOS paths", () => {
    const result = redactHomePathUserSegments("/Users/alice/projects/foo");
    expect(result).toBe("/Users/a****/projects/foo");
  });

  it("redacts /home/<name> on Linux paths", () => {
    const result = redactHomePathUserSegments("/home/bob/workspace");
    expect(result).toBe("/home/b**/workspace");
  });

  it("redacts Windows Users path", () => {
    const result = redactHomePathUserSegments("C:\\Users\\Carol\\AppData");
    expect(result).toBe("C:\\Users\\C****\\AppData");
  });

  it("leaves non-home paths untouched", () => {
    const input = "/var/log/app.log";
    expect(redactHomePathUserSegments(input)).toBe(input);
  });

  it("redacts multiple occurrences in the same string", () => {
    const result = redactHomePathUserSegments(
      "Copied from /Users/alice/src to /Users/bob/dst",
    );
    expect(result).toContain("/Users/a****");
    expect(result).toContain("/Users/b**/dst");
  });

  it("does nothing when opts.enabled is false", () => {
    const input = "/Users/alice/secret";
    expect(redactHomePathUserSegments(input, { enabled: false })).toBe(input);
  });

  it("works on a single-char username", () => {
    const result = redactHomePathUserSegments("/Users/x/file");
    expect(result).toBe("/Users/x*/file");
  });

  it("returns empty string unchanged", () => {
    expect(redactHomePathUserSegments("")).toBe("");
  });

  it("redacts username in a longer sentence", () => {
    const result = redactHomePathUserSegments("Error opening /home/johndoe/code/app");
    expect(result).toContain("/home/j******");
  });
});

describe("redactHomePathUserSegmentsInValue", () => {
  it("redacts in string values", () => {
    expect(redactHomePathUserSegmentsInValue("/Users/alice/file")).toBe("/Users/a****/file");
  });

  it("recurses into objects", () => {
    const result = redactHomePathUserSegmentsInValue({
      path: "/Users/dave/src",
      nested: { cwd: "/home/dave/work" },
    });
    expect((result as any).path).toBe("/Users/d***/src");
    expect((result as any).nested.cwd).toBe("/home/d***/work");
  });

  it("recurses into arrays", () => {
    const result = redactHomePathUserSegmentsInValue(["/Users/eve/a", "/Users/eve/b"]);
    expect(result).toEqual(["/Users/e**/a", "/Users/e**/b"]);
  });

  it("leaves numbers unchanged", () => {
    expect(redactHomePathUserSegmentsInValue(42)).toBe(42);
  });

  it("leaves booleans unchanged", () => {
    expect(redactHomePathUserSegmentsInValue(true)).toBe(true);
  });

  it("leaves null unchanged", () => {
    expect(redactHomePathUserSegmentsInValue(null)).toBeNull();
  });

  it("does not redact when opts.enabled is false", () => {
    const obj = { path: "/Users/alice/secret" };
    const result = redactHomePathUserSegmentsInValue(obj, { enabled: false }) as typeof obj;
    expect(result.path).toBe("/Users/alice/secret");
  });
});
