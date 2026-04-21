/**
 * Tests for adapter-skills validators.
 */
import { describe, expect, it } from "vitest";
import {
  agentSkillEntrySchema,
  agentSkillOriginSchema,
  agentSkillSnapshotSchema,
  agentSkillStateSchema,
  agentSkillSyncModeSchema,
  agentSkillSyncSchema,
} from "./adapter-skills.js";

// ──────────────────────────────────────────────────────────
// agentSkillStateSchema
// ──────────────────────────────────────────────────────────

describe("agentSkillStateSchema", () => {
  it("accepts all valid states", () => {
    for (const s of ["available", "configured", "installed", "missing", "stale", "external"]) {
      expect(agentSkillStateSchema.safeParse(s).success, `state=${s}`).toBe(true);
    }
  });

  it("rejects unknown state", () => {
    expect(agentSkillStateSchema.safeParse("active").success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// agentSkillOriginSchema
// ──────────────────────────────────────────────────────────

describe("agentSkillOriginSchema", () => {
  it("accepts all valid origins", () => {
    for (const o of ["company_managed", "paperclip_required", "user_installed", "external_unknown"]) {
      expect(agentSkillOriginSchema.safeParse(o).success, `origin=${o}`).toBe(true);
    }
  });

  it("rejects unknown origin", () => {
    expect(agentSkillOriginSchema.safeParse("admin_installed").success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// agentSkillSyncModeSchema
// ──────────────────────────────────────────────────────────

describe("agentSkillSyncModeSchema", () => {
  it("accepts unsupported", () => {
    expect(agentSkillSyncModeSchema.safeParse("unsupported").success).toBe(true);
  });

  it("accepts persistent", () => {
    expect(agentSkillSyncModeSchema.safeParse("persistent").success).toBe(true);
  });

  it("accepts ephemeral", () => {
    expect(agentSkillSyncModeSchema.safeParse("ephemeral").success).toBe(true);
  });

  it("rejects unknown mode", () => {
    expect(agentSkillSyncModeSchema.safeParse("lazy").success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// agentSkillEntrySchema
// ──────────────────────────────────────────────────────────

describe("agentSkillEntrySchema", () => {
  const valid = {
    key: "memory-search",
    runtimeName: "memory_search",
    desired: true,
    managed: false,
    state: "installed",
  };

  it("accepts minimal valid entry", () => {
    expect(agentSkillEntrySchema.safeParse(valid).success).toBe(true);
  });

  it("accepts null runtimeName", () => {
    expect(agentSkillEntrySchema.safeParse({ ...valid, runtimeName: null }).success).toBe(true);
  });

  it("rejects empty key", () => {
    expect(agentSkillEntrySchema.safeParse({ ...valid, key: "" }).success).toBe(false);
  });

  it("rejects invalid state", () => {
    expect(agentSkillEntrySchema.safeParse({ ...valid, state: "broken" }).success).toBe(false);
  });

  it("accepts optional origin", () => {
    expect(
      agentSkillEntrySchema.safeParse({ ...valid, origin: "company_managed" }).success,
    ).toBe(true);
  });

  it("accepts optional sourcePath as null", () => {
    expect(
      agentSkillEntrySchema.safeParse({ ...valid, sourcePath: null }).success,
    ).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// agentSkillSnapshotSchema
// ──────────────────────────────────────────────────────────

describe("agentSkillSnapshotSchema", () => {
  const validEntry = {
    key: "task-manager",
    runtimeName: null,
    desired: false,
    managed: true,
    state: "available",
  };

  const valid = {
    adapterType: "claude_local",
    supported: true,
    mode: "persistent",
    desiredSkills: ["task-manager"],
    entries: [validEntry],
    warnings: [],
  };

  it("accepts valid snapshot", () => {
    expect(agentSkillSnapshotSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty adapterType", () => {
    expect(agentSkillSnapshotSchema.safeParse({ ...valid, adapterType: "" }).success).toBe(false);
  });

  it("rejects invalid mode", () => {
    expect(agentSkillSnapshotSchema.safeParse({ ...valid, mode: "auto" }).success).toBe(false);
  });

  it("accepts empty desiredSkills and entries", () => {
    expect(
      agentSkillSnapshotSchema.safeParse({ ...valid, desiredSkills: [], entries: [] }).success,
    ).toBe(true);
  });

  it("rejects desiredSkills with empty string entry", () => {
    expect(
      agentSkillSnapshotSchema.safeParse({ ...valid, desiredSkills: [""] }).success,
    ).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// agentSkillSyncSchema
// ──────────────────────────────────────────────────────────

describe("agentSkillSyncSchema", () => {
  it("accepts valid desiredSkills", () => {
    expect(agentSkillSyncSchema.safeParse({ desiredSkills: ["memory-search", "task-assign"] }).success).toBe(true);
  });

  it("accepts empty desiredSkills array", () => {
    expect(agentSkillSyncSchema.safeParse({ desiredSkills: [] }).success).toBe(true);
  });

  it("rejects desiredSkills with empty string", () => {
    expect(agentSkillSyncSchema.safeParse({ desiredSkills: [""] }).success).toBe(false);
  });

  it("rejects missing desiredSkills", () => {
    expect(agentSkillSyncSchema.safeParse({}).success).toBe(false);
  });
});
