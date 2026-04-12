/**
 * Tests for skill injection pipeline:
 *   readPaperclipRuntimeSkillEntries → resolvePaperclipDesiredSkillNames
 *
 * Critical regression: `paperclipRuntimeSkills: []` in agent config must mean
 * "no skills" — not "auto-discover". An empty explicit array previously fell
 * through to filesystem auto-discovery, causing ~12K tokens of unwanted skill
 * content to be injected into every ollama agent's context.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listPaperclipSkillEntries,
  readPaperclipRuntimeSkillEntries,
  renderTemplate,
  resolvePaperclipDesiredSkillNames,
  resolvePaperclipSkillsDir,
  resolvePathValue,
} from "./server-utils.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string | null = null;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pc-skill-test-"));
});

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

// ---------------------------------------------------------------------------
// readPaperclipRuntimeSkillEntries
// ---------------------------------------------------------------------------

describe("readPaperclipRuntimeSkillEntries", () => {
  describe("explicit array in config bypasses auto-discovery", () => {
    it("returns [] when paperclipRuntimeSkills is set to [] — the regression fix", async () => {
      // A non-existent moduleDir proves the filesystem is never touched.
      const result = await readPaperclipRuntimeSkillEntries(
        { paperclipRuntimeSkills: [] },
        "/nonexistent-dir-should-not-be-accessed",
      );
      expect(result).toEqual([]);
    });

    it("returns configured entries when paperclipRuntimeSkills has valid items", async () => {
      const configured = [
        { key: "acme/my-skill", runtimeName: "my-skill", source: "/opt/skills/my-skill", required: false },
      ];
      const result = await readPaperclipRuntimeSkillEntries(
        { paperclipRuntimeSkills: configured },
        "/nonexistent-dir-should-not-be-accessed",
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        key: "acme/my-skill",
        runtimeName: "my-skill",
        source: "/opt/skills/my-skill",
        required: false,
        requiredReason: null,
      });
    });

    it("filters out entries missing key, runtimeName, or source", async () => {
      const configured = [
        { key: "good", runtimeName: "good", source: "/a/path" },      // valid
        { key: "", runtimeName: "bad-no-key", source: "/b/path" },    // empty key — dropped
        { key: "bad-no-name", source: "/c/path" },                    // no runtimeName — dropped
        { key: "bad-no-source", runtimeName: "bad-no-source" },       // no source — dropped
        { key: "also-good", runtimeName: "also-good", source: "/d/path", required: true },
      ];
      const result = await readPaperclipRuntimeSkillEntries(
        { paperclipRuntimeSkills: configured },
        "/nonexistent",
      );
      expect(result).toHaveLength(2);
      expect(result.map((e) => e.key)).toEqual(["good", "also-good"]);
    });

    it("marks entries as required when required:true is in the config", async () => {
      const configured = [
        { key: "req", runtimeName: "req", source: "/x", required: true, requiredReason: "critical" },
        { key: "opt", runtimeName: "opt", source: "/y", required: false },
      ];
      const result = await readPaperclipRuntimeSkillEntries(
        { paperclipRuntimeSkills: configured },
        "/nonexistent",
      );
      const req = result.find((e) => e.key === "req");
      const opt = result.find((e) => e.key === "opt");
      expect(req?.required).toBe(true);
      expect(req?.requiredReason).toBe("critical");
      expect(opt?.required).toBe(false);
      expect(opt?.requiredReason).toBeNull();
    });
  });

  describe("auto-discovery when paperclipRuntimeSkills is absent", () => {
    it("auto-discovers skills from an additional candidate directory", async () => {
      // Create two fake skill subdirectories in the temp dir.
      await fs.mkdir(path.join(tmpDir!, "alpha"));
      await fs.mkdir(path.join(tmpDir!, "beta"));
      // Also put a file (not a directory) — it should be ignored.
      await fs.writeFile(path.join(tmpDir!, "not-a-skill.txt"), "hello");

      const result = await readPaperclipRuntimeSkillEntries(
        {}, // no paperclipRuntimeSkills key → auto-discover
        "/nonexistent-module-dir",
        [tmpDir!], // pass temp dir as additional candidate
      );

      expect(result).toHaveLength(2);
      const keys = result.map((e) => e.key).sort();
      expect(keys).toEqual(["paperclipai/paperclip/alpha", "paperclipai/paperclip/beta"]);
      // Auto-discovered skills are always required.
      expect(result.every((e) => e.required === true)).toBe(true);
    });

    it("falls back to auto-discovery when paperclipRuntimeSkills is null (not an array)", async () => {
      await fs.mkdir(path.join(tmpDir!, "gamma"));

      const result = await readPaperclipRuntimeSkillEntries(
        { paperclipRuntimeSkills: null }, // null is not an array → auto-discover
        "/nonexistent-module-dir",
        [tmpDir!],
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.key).toBe("paperclipai/paperclip/gamma");
    });

    it("falls back to auto-discovery when paperclipRuntimeSkills is a string (not an array)", async () => {
      await fs.mkdir(path.join(tmpDir!, "delta"));

      const result = await readPaperclipRuntimeSkillEntries(
        { paperclipRuntimeSkills: "some-string" }, // not an array → auto-discover
        "/nonexistent-module-dir",
        [tmpDir!],
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.key).toBe("paperclipai/paperclip/delta");
    });

    it("returns [] when no skills directory is found anywhere", async () => {
      const result = await readPaperclipRuntimeSkillEntries(
        {}, // auto-discover, but no real skills dir accessible
        "/nonexistent-module-dir",
        // no additional candidates
      );
      expect(result).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// resolvePaperclipDesiredSkillNames
// ---------------------------------------------------------------------------

describe("resolvePaperclipDesiredSkillNames", () => {
  it("returns [] when available entries are empty", () => {
    expect(resolvePaperclipDesiredSkillNames({}, [])).toEqual([]);
  });

  it("always injects entries with required:true", () => {
    const entries = [
      { key: "core", runtimeName: "core", required: true },
      { key: "optional", runtimeName: "optional", required: false },
    ];
    expect(resolvePaperclipDesiredSkillNames({}, entries)).toEqual(["core"]);
  });

  it("returns [] when all available entries have required:false and no explicit preference", () => {
    const entries = [
      { key: "nice-to-have", runtimeName: "nice", required: false },
    ];
    expect(resolvePaperclipDesiredSkillNames({}, entries)).toEqual([]);
  });

  it("deduplicates entries that appear both as required and in paperclipSkillSync.desiredSkills", () => {
    const entries = [
      { key: "core", runtimeName: "core", required: true },
      { key: "extra", runtimeName: "extra", required: false },
    ];
    const config = { paperclipSkillSync: { desiredSkills: ["core", "extra"] } };
    const result = resolvePaperclipDesiredSkillNames(config, entries);
    expect(result).toEqual(["core", "extra"]); // no duplicates
  });

  it("adds optional skills named in paperclipSkillSync.desiredSkills", () => {
    const entries = [
      { key: "req", runtimeName: "req", required: true },
      { key: "opt", runtimeName: "opt", required: false },
    ];
    const config = { paperclipSkillSync: { desiredSkills: ["opt"] } };
    expect(resolvePaperclipDesiredSkillNames(config, entries)).toEqual(["req", "opt"]);
  });
});

// ---------------------------------------------------------------------------
// Full pipeline integration
// ---------------------------------------------------------------------------

describe("skill injection pipeline (integration)", () => {
  it("paperclipRuntimeSkills:[] → zero skills injected end-to-end", async () => {
    const config = { paperclipRuntimeSkills: [] };

    // Step 1: adapter reads its skill entries.
    const entries = await readPaperclipRuntimeSkillEntries(config, "/nonexistent");

    // Step 2: heartbeat layer decides which skills to inject.
    const desired = resolvePaperclipDesiredSkillNames(config, entries);

    expect(entries).toEqual([]);
    expect(desired).toEqual([]);
    // Result: no skill markdown will be loaded → system prompt stays compact.
  });

  it("omitting paperclipRuntimeSkills + a skills directory → skills auto-injected", async () => {
    await fs.mkdir(path.join(tmpDir!, "paperclip")); // one bundled skill

    const config = {}; // no explicit skills config

    const entries = await readPaperclipRuntimeSkillEntries(config, "/nonexistent", [tmpDir!]);
    const desired = resolvePaperclipDesiredSkillNames(config, entries);

    expect(entries).toHaveLength(1);
    expect(desired).toEqual(["paperclipai/paperclip/paperclip"]); // required → injected
  });

  it("explicit entries with required:false → nothing injected even with non-empty config", async () => {
    const config = {
      paperclipRuntimeSkills: [
        { key: "unused-skill", runtimeName: "unused-skill", source: "/some/path", required: false },
      ],
    };

    const entries = await readPaperclipRuntimeSkillEntries(config, "/nonexistent");
    const desired = resolvePaperclipDesiredSkillNames(config, entries);

    expect(entries).toHaveLength(1); // entry is present…
    expect(desired).toEqual([]);     // …but not injected (required:false, no explicit preference)
  });
});

// ---------------------------------------------------------------------------
// resolvePathValue / renderTemplate
// ---------------------------------------------------------------------------

describe("resolvePathValue", () => {
  it("resolves a top-level key", () => {
    expect(resolvePathValue({ foo: "bar" }, "foo")).toBe("bar");
  });

  it("resolves nested keys with dot notation", () => {
    const obj = { context: { paperclipWake: { issue: { title: "Hire an engineer" } } } };
    expect(resolvePathValue(obj, "context.paperclipWake.issue.title")).toBe("Hire an engineer");
  });

  it("returns empty string for missing paths", () => {
    expect(resolvePathValue({}, "context.missing.path")).toBe("");
  });

  it("returns empty string for null at a node", () => {
    expect(resolvePathValue({ context: null } as Record<string, unknown>, "context.foo")).toBe("");
  });

  it("stringifies numbers and booleans", () => {
    expect(resolvePathValue({ n: 42 }, "n")).toBe("42");
    expect(resolvePathValue({ b: false }, "b")).toBe("false");
  });

  it("returns empty string for null leaf value", () => {
    expect(resolvePathValue({ x: null }, "x")).toBe("");
  });

  it("returns empty string for undefined leaf value", () => {
    expect(resolvePathValue({ x: undefined }, "x")).toBe("");
  });
});

describe("renderTemplate", () => {
  it("replaces a single {{variable}}", () => {
    expect(renderTemplate("Hello, {{name}}!", { name: "CEO" })).toBe("Hello, CEO!");
  });

  it("replaces nested dot-paths like {{context.paperclipWake.issue.title}}", () => {
    const data = {
      context: {
        paperclipWake: {
          issue: {
            title: "Hire a backend engineer",
            description: "We need one urgently.",
          },
        },
        wakeReason: "issue_assigned",
      },
    };
    const template =
      "## {{context.paperclipWake.issue.title}}\n\n{{context.paperclipWake.issue.description}}\n\nWake: {{context.wakeReason}}";
    expect(renderTemplate(template, data)).toBe(
      "## Hire a backend engineer\n\nWe need one urgently.\n\nWake: issue_assigned",
    );
  });

  it("replaces multiple different variables in one pass", () => {
    const data = { agent: { id: "ag_01", name: "CEO" }, run: { id: "run_99" } };
    expect(renderTemplate("{{agent.name}} ({{agent.id}}) — run {{run.id}}", data)).toBe(
      "CEO (ag_01) — run run_99",
    );
  });

  it("leaves template text unchanged when path is missing", () => {
    // Missing path resolves to "" — so {{missing}} becomes ""
    expect(renderTemplate("before{{missing}}after", {})).toBe("beforeafter");
  });

  it("handles whitespace inside braces: {{ name }}", () => {
    expect(renderTemplate("{{ name }}", { name: "World" })).toBe("World");
  });

  it("does not replace non-template-style text", () => {
    expect(renderTemplate("no variables here", {})).toBe("no variables here");
  });
});

// ---------------------------------------------------------------------------
// resolvePaperclipSkillsDir / listPaperclipSkillEntries
// ---------------------------------------------------------------------------

describe("resolvePaperclipSkillsDir", () => {
  it("returns the first additional candidate that exists", async () => {
    const result = await resolvePaperclipSkillsDir("/nonexistent-module", [tmpDir!]);
    expect(result).toBe(tmpDir);
  });

  it("returns null when no candidate exists", async () => {
    const result = await resolvePaperclipSkillsDir("/nonexistent-module", ["/also/nonexistent"]);
    expect(result).toBeNull();
  });
});

describe("listPaperclipSkillEntries", () => {
  it("returns one entry per subdirectory, ignoring files", async () => {
    await fs.mkdir(path.join(tmpDir!, "skill-a"));
    await fs.mkdir(path.join(tmpDir!, "skill-b"));
    await fs.writeFile(path.join(tmpDir!, "README.md"), "docs");

    const entries = await listPaperclipSkillEntries("/nonexistent", [tmpDir!]);

    expect(entries).toHaveLength(2);
    const names = entries.map((e) => e.runtimeName).sort();
    expect(names).toEqual(["skill-a", "skill-b"]);
    expect(entries.every((e) => e.key.startsWith("paperclipai/paperclip/"))).toBe(true);
    expect(entries.every((e) => e.required === true)).toBe(true);
  });

  it("returns [] when the skills directory is empty", async () => {
    const entries = await listPaperclipSkillEntries("/nonexistent", [tmpDir!]);
    expect(entries).toEqual([]);
  });

  it("returns [] when no skills directory exists", async () => {
    const entries = await listPaperclipSkillEntries("/nonexistent");
    expect(entries).toEqual([]);
  });
});
