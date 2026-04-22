import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { printStaplerCliBanner } from "./banner.js";

describe("printStaplerCliBanner", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("calls console.log exactly once", () => {
    printStaplerCliBanner();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it("outputs a string (joined lines)", () => {
    printStaplerCliBanner();
    const [output] = consoleSpy.mock.calls[0];
    expect(typeof output).toBe("string");
  });

  it("output contains the STAPLER art text fragments", () => {
    printStaplerCliBanner();
    const output = consoleSpy.mock.calls[0][0] as string;
    // The art contains "STAPLER" split across lines; check for key fragments
    expect(output).toContain("███████╗");
  });

  it("output contains the tagline", () => {
    printStaplerCliBanner();
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain("Open-source orchestration for zero-human companies");
  });

  it("output starts and ends with blank lines", () => {
    printStaplerCliBanner();
    const output = consoleSpy.mock.calls[0][0] as string;
    const lines = output.split("\n");
    expect(lines[0]).toBe("");
    expect(lines[lines.length - 1]).toBe("");
  });

  it("returns void (undefined)", () => {
    const result = printStaplerCliBanner();
    expect(result).toBeUndefined();
  });
});
