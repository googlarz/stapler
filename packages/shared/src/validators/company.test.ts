import { describe, expect, it } from "vitest";
import {
  companySkillCreateSchema,
  companySkillImportSchema,
  companySkillSourceTypeSchema,
  companySkillTrustLevelSchema,
  createCompanySchema,
  updateCompanyBrandingSchema,
  updateCompanySchema,
} from "./index.js";

// ──────────────────────────────────────────────────────────
// createCompanySchema
// ──────────────────────────────────────────────────────────

describe("createCompanySchema", () => {
  it("accepts minimal valid company", () => {
    const r = createCompanySchema.safeParse({ name: "Acme Corp" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.budgetMonthlyCents).toBe(0);
    }
  });

  it("rejects empty name", () => {
    expect(createCompanySchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects negative budget", () => {
    expect(createCompanySchema.safeParse({ name: "Co", budgetMonthlyCents: -1 }).success).toBe(false);
  });

  it("rejects fractional budget", () => {
    expect(createCompanySchema.safeParse({ name: "Co", budgetMonthlyCents: 1.5 }).success).toBe(false);
  });

  it("accepts zero budget", () => {
    expect(createCompanySchema.safeParse({ name: "Co", budgetMonthlyCents: 0 }).success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// updateCompanySchema
// ──────────────────────────────────────────────────────────

describe("updateCompanySchema", () => {
  it("accepts empty patch", () => {
    expect(updateCompanySchema.safeParse({}).success).toBe(true);
  });

  it("accepts partial name update", () => {
    expect(updateCompanySchema.safeParse({ name: "New Name" }).success).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(updateCompanySchema.safeParse({ status: "deleted" }).success).toBe(false);
  });

  it("accepts valid brandColor", () => {
    expect(updateCompanySchema.safeParse({ brandColor: "#aabbcc" }).success).toBe(true);
  });

  it("rejects invalid brandColor format", () => {
    expect(updateCompanySchema.safeParse({ brandColor: "red" }).success).toBe(false);
  });

  it("accepts null brandColor", () => {
    expect(updateCompanySchema.safeParse({ brandColor: null }).success).toBe(true);
  });

  it("rejects non-UUID logoAssetId", () => {
    expect(updateCompanySchema.safeParse({ logoAssetId: "not-uuid" }).success).toBe(false);
  });

  it("accepts null logoAssetId", () => {
    expect(updateCompanySchema.safeParse({ logoAssetId: null }).success).toBe(true);
  });

  it("rejects requireBoardApprovalForNewAgents non-boolean", () => {
    expect(updateCompanySchema.safeParse({ requireBoardApprovalForNewAgents: "yes" }).success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// updateCompanyBrandingSchema
// ──────────────────────────────────────────────────────────

describe("updateCompanyBrandingSchema", () => {
  it("accepts name-only update", () => {
    expect(updateCompanyBrandingSchema.safeParse({ name: "New Name" }).success).toBe(true);
  });

  it("accepts brandColor-only update", () => {
    expect(updateCompanyBrandingSchema.safeParse({ brandColor: "#112233" }).success).toBe(true);
  });

  it("rejects empty object (at least one field required)", () => {
    expect(updateCompanyBrandingSchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown extra keys (strict)", () => {
    expect(updateCompanyBrandingSchema.safeParse({ name: "Co", unknownField: true }).success).toBe(false);
  });

  it("accepts all branding fields together", () => {
    expect(updateCompanyBrandingSchema.safeParse({
      name: "Rebranded",
      description: "New desc",
      brandColor: "#ffffff",
      logoAssetId: null,
    }).success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// companySkillSourceTypeSchema / companySkillTrustLevelSchema
// ──────────────────────────────────────────────────────────

describe("companySkillSourceTypeSchema", () => {
  it("accepts all valid source types", () => {
    for (const t of ["local_path", "github", "url", "catalog", "skills_sh"]) {
      expect(companySkillSourceTypeSchema.safeParse(t).success, `type=${t}`).toBe(true);
    }
  });

  it("rejects unknown source type", () => {
    expect(companySkillSourceTypeSchema.safeParse("npm").success).toBe(false);
  });
});

describe("companySkillTrustLevelSchema", () => {
  it("accepts all valid trust levels", () => {
    for (const level of ["markdown_only", "assets", "scripts_executables"]) {
      expect(companySkillTrustLevelSchema.safeParse(level).success, `level=${level}`).toBe(true);
    }
  });

  it("rejects unknown trust level", () => {
    expect(companySkillTrustLevelSchema.safeParse("full").success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// companySkillCreateSchema
// ──────────────────────────────────────────────────────────

describe("companySkillCreateSchema", () => {
  it("accepts minimal valid skill", () => {
    expect(companySkillCreateSchema.safeParse({ name: "My Skill" }).success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(companySkillCreateSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("accepts with slug and description", () => {
    expect(companySkillCreateSchema.safeParse({
      name: "My Skill",
      slug: "my-skill",
      description: "Does stuff",
      markdown: "# My Skill\nInstructions here.",
    }).success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// companySkillImportSchema
// ──────────────────────────────────────────────────────────

describe("companySkillImportSchema", () => {
  it("accepts valid source string", () => {
    expect(companySkillImportSchema.safeParse({ source: "github:org/repo/skill.md" }).success).toBe(true);
  });

  it("rejects empty source", () => {
    expect(companySkillImportSchema.safeParse({ source: "" }).success).toBe(false);
  });

  it("rejects missing source", () => {
    expect(companySkillImportSchema.safeParse({}).success).toBe(false);
  });
});
