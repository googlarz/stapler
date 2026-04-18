import { describe, expect, it, vi } from "vitest";
import { resolveSystemPrompt } from "./execute.js";

describe("resolveSystemPrompt precedence", () => {
  it("returns explicit config.system when set (file is ignored)", async () => {
    const readFile = vi.fn();
    const out = await resolveSystemPrompt(
      { system: "  explicit prompt  ", instructionsFilePath: "/tmp/ignored.md" },
      { readFile },
    );
    expect(out).toBe("explicit prompt");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("reads instructionsFilePath and appends path directive when system is empty", async () => {
    const readFile = vi.fn(async () => "FILE BODY");
    const out = await resolveSystemPrompt(
      { system: "", instructionsFilePath: "/abs/path/INSTRUCTIONS.md" },
      { readFile },
    );
    expect(readFile).toHaveBeenCalledWith("/abs/path/INSTRUCTIONS.md");
    expect(out.startsWith("FILE BODY")).toBe(true);
    expect(out).toContain("loaded from /abs/path/INSTRUCTIONS.md");
    expect(out).toContain("edit that file directly");
  });

  it("falls back to default prompt and logs a warning when file read fails", async () => {
    const readFile = vi.fn(async () => {
      throw new Error("ENOENT: no such file");
    });
    const warnings: string[] = [];
    const out = await resolveSystemPrompt(
      { instructionsFilePath: "/missing.md" },
      { readFile, writeWarning: (m) => warnings.push(m) },
    );
    expect(out).toContain("autonomous AI agent running inside Stapler");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('could not read agent instructions file "/missing.md"');
    expect(warnings[0]).toContain("ENOENT");
  });

  it("falls back to default prompt when neither system nor instructionsFilePath is set", async () => {
    const readFile = vi.fn();
    const out = await resolveSystemPrompt({}, { readFile });
    expect(out).toContain("autonomous AI agent running inside Stapler");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("treats whitespace-only config.system as empty and falls through to file", async () => {
    const readFile = vi.fn(async () => "FILE BODY");
    const out = await resolveSystemPrompt(
      { system: "   \n  ", instructionsFilePath: "/file.md" },
      { readFile },
    );
    expect(readFile).toHaveBeenCalledWith("/file.md");
    expect(out.startsWith("FILE BODY")).toBe(true);
  });

  it("uses tool-only default prompt when enableTools is true (default)", async () => {
    const out = await resolveSystemPrompt({});
    // Tool-only prompt forbids bare text responses.
    expect(out).toContain("MUST NOT write plain text");
    expect(out).toContain("Every action you take MUST be a tool call");
  });

  it("uses text-deliverable default prompt when enableTools is false", async () => {
    const out = await resolveSystemPrompt({}, { enableTools: false });
    // Text prompt must NOT tell the model text is invisible.
    expect(out).not.toContain("MUST NOT write plain text");
    expect(out).not.toContain("invisible to the system");
    // And should explicitly frame text as the deliverable.
    expect(out).toContain("no tool calls available");
    expect(out).toContain("deliverable");
  });

  it("falls back to text-deliverable default on read error when enableTools is false", async () => {
    const readFile = vi.fn(async () => {
      throw new Error("ENOENT");
    });
    const out = await resolveSystemPrompt(
      { instructionsFilePath: "/missing.md" },
      { readFile, writeWarning: () => {}, enableTools: false },
    );
    expect(out).not.toContain("MUST NOT write plain text");
    expect(out).toContain("deliverable");
  });
});
