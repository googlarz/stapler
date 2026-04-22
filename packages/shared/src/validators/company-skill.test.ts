import { describe, it, expect } from "vitest";
import {
  companySkillSourceTypeSchema,
  companySkillTrustLevelSchema,
  companySkillCompatibilitySchema,
  companySkillSourceBadgeSchema,
  companySkillFileInventoryEntrySchema,
  companySkillSchema,
  companySkillListItemSchema,
  companySkillDetailSchema,
  companySkillUpdateStatusSchema,
  companySkillImportSchema,
  companySkillProjectScanRequestSchema,
  companySkillCreateSchema,
  companySkillFileDetailSchema,
  companySkillFileUpdateSchema,
} from "./company-skill.js";

const uuid = "550e8400-e29b-41d4-a716-446655440000";
const uuid2 = "550e8400-e29b-41d4-a716-446655440001";

describe("companySkillSourceTypeSchema", () => {
  it("accepts valid source types", () => {
    for (const type of ["local_path", "github", "url", "catalog", "skills_sh"]) {
      expect(companySkillSourceTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("rejects invalid source type", () => {
    expect(companySkillSourceTypeSchema.safeParse("npm").success).toBe(false);
  });
});

describe("companySkillTrustLevelSchema", () => {
  it("accepts valid trust levels", () => {
    for (const level of ["markdown_only", "assets", "scripts_executables"]) {
      expect(companySkillTrustLevelSchema.safeParse(level).success).toBe(true);
    }
  });

  it("rejects invalid trust level", () => {
    expect(companySkillTrustLevelSchema.safeParse("full_trust").success).toBe(false);
  });
});

describe("companySkillCompatibilitySchema", () => {
  it("accepts valid compatibility values", () => {
    for (const val of ["compatible", "unknown", "invalid"]) {
      expect(companySkillCompatibilitySchema.safeParse(val).success).toBe(true);
    }
  });
});

describe("companySkillFileInventoryEntrySchema", () => {
  it("accepts valid entry", () => {
    expect(companySkillFileInventoryEntrySchema.safeParse({ path: "SKILL.md", kind: "skill" }).success).toBe(true);
  });

  it("accepts all valid kinds", () => {
    for (const kind of ["skill", "markdown", "reference", "script", "asset", "other"]) {
      expect(companySkillFileInventoryEntrySchema.safeParse({ path: "file.txt", kind }).success).toBe(true);
    }
  });

  it("rejects empty path", () => {
    expect(companySkillFileInventoryEntrySchema.safeParse({ path: "", kind: "skill" }).success).toBe(false);
  });

  it("rejects invalid kind", () => {
    expect(companySkillFileInventoryEntrySchema.safeParse({ path: "file.txt", kind: "config" }).success).toBe(false);
  });
});

describe("companySkillSchema", () => {
  const validSkill = {
    id: uuid,
    companyId: uuid2,
    key: "my-skill",
    slug: "my-skill",
    name: "My Skill",
    description: null,
    markdown: "# My Skill",
    sourceType: "local_path",
    sourceLocator: null,
    sourceRef: null,
    trustLevel: "markdown_only",
    compatibility: "compatible",
    fileInventory: [],
    metadata: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("accepts valid skill", () => {
    expect(companySkillSchema.safeParse(validSkill).success).toBe(true);
  });

  it("coerces date strings to Date objects", () => {
    const result = companySkillSchema.safeParse(validSkill);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.createdAt).toBeInstanceOf(Date);
      expect(result.data.updatedAt).toBeInstanceOf(Date);
    }
  });

  it("defaults fileInventory to empty array", () => {
    const { fileInventory: _, ...withoutInventory } = validSkill;
    const result = companySkillSchema.safeParse(withoutInventory);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fileInventory).toEqual([]);
    }
  });

  it("rejects invalid uuid for id", () => {
    expect(companySkillSchema.safeParse({ ...validSkill, id: "not-uuid" }).success).toBe(false);
  });

  it("rejects empty key", () => {
    expect(companySkillSchema.safeParse({ ...validSkill, key: "" }).success).toBe(false);
  });
});

describe("companySkillListItemSchema", () => {
  const validSkill = {
    id: uuid,
    companyId: uuid2,
    key: "skill",
    slug: "skill",
    name: "Skill",
    description: null,
    markdown: "",
    sourceType: "github",
    sourceLocator: null,
    sourceRef: null,
    trustLevel: "assets",
    compatibility: "unknown",
    fileInventory: [],
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    attachedAgentCount: 2,
    editable: true,
    editableReason: null,
    sourceLabel: "GitHub",
    sourceBadge: "github",
  };

  it("accepts valid list item", () => {
    expect(companySkillListItemSchema.safeParse(validSkill).success).toBe(true);
  });

  it("rejects negative attachedAgentCount", () => {
    expect(companySkillListItemSchema.safeParse({ ...validSkill, attachedAgentCount: -1 }).success).toBe(false);
  });
});

describe("companySkillUpdateStatusSchema", () => {
  it("accepts valid update status", () => {
    expect(companySkillUpdateStatusSchema.safeParse({
      supported: true,
      reason: null,
      trackingRef: "main",
      currentRef: "abc123",
      latestRef: "def456",
      hasUpdate: true,
    }).success).toBe(true);
  });

  it("rejects missing fields", () => {
    expect(companySkillUpdateStatusSchema.safeParse({ supported: true }).success).toBe(false);
  });
});

describe("companySkillImportSchema", () => {
  it("accepts valid source string", () => {
    expect(companySkillImportSchema.safeParse({ source: "https://github.com/org/skills" }).success).toBe(true);
  });

  it("rejects empty source", () => {
    expect(companySkillImportSchema.safeParse({ source: "" }).success).toBe(false);
  });

  it("rejects missing source", () => {
    expect(companySkillImportSchema.safeParse({}).success).toBe(false);
  });
});

describe("companySkillProjectScanRequestSchema", () => {
  it("accepts empty object", () => {
    expect(companySkillProjectScanRequestSchema.safeParse({}).success).toBe(true);
  });

  it("accepts valid uuid arrays", () => {
    expect(companySkillProjectScanRequestSchema.safeParse({
      projectIds: [uuid],
      workspaceIds: [uuid2],
    }).success).toBe(true);
  });

  it("rejects invalid uuids", () => {
    expect(companySkillProjectScanRequestSchema.safeParse({ projectIds: ["not-uuid"] }).success).toBe(false);
  });
});

describe("companySkillCreateSchema", () => {
  it("accepts minimal valid input", () => {
    expect(companySkillCreateSchema.safeParse({ name: "My Skill" }).success).toBe(true);
  });

  it("accepts full input", () => {
    expect(companySkillCreateSchema.safeParse({
      name: "My Skill",
      slug: "my-skill",
      description: "A useful skill",
      markdown: "# My Skill\n\nContent here.",
    }).success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(companySkillCreateSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("accepts null optional fields", () => {
    expect(companySkillCreateSchema.safeParse({
      name: "Skill",
      slug: null,
      description: null,
      markdown: null,
    }).success).toBe(true);
  });
});

describe("companySkillFileDetailSchema", () => {
  it("accepts valid file detail", () => {
    expect(companySkillFileDetailSchema.safeParse({
      skillId: uuid,
      path: "SKILL.md",
      kind: "skill",
      content: "# Skill",
      language: "markdown",
      markdown: true,
      editable: true,
    }).success).toBe(true);
  });

  it("accepts null language", () => {
    expect(companySkillFileDetailSchema.safeParse({
      skillId: uuid,
      path: "script.sh",
      kind: "script",
      content: "#!/bin/bash",
      language: null,
      markdown: false,
      editable: false,
    }).success).toBe(true);
  });

  it("rejects empty path", () => {
    expect(companySkillFileDetailSchema.safeParse({
      skillId: uuid,
      path: "",
      kind: "skill",
      content: "",
      language: null,
      markdown: false,
      editable: false,
    }).success).toBe(false);
  });
});

describe("companySkillFileUpdateSchema", () => {
  it("accepts valid update", () => {
    expect(companySkillFileUpdateSchema.safeParse({ path: "SKILL.md", content: "Updated content" }).success).toBe(true);
  });

  it("accepts empty content string", () => {
    expect(companySkillFileUpdateSchema.safeParse({ path: "SKILL.md", content: "" }).success).toBe(true);
  });

  it("rejects empty path", () => {
    expect(companySkillFileUpdateSchema.safeParse({ path: "", content: "content" }).success).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(companySkillFileUpdateSchema.safeParse({ path: "SKILL.md" }).success).toBe(false);
  });
});
