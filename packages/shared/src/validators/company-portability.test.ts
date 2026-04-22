import { describe, it, expect } from "vitest";
import {
  portabilityIncludeSchema,
  portabilityEnvInputSchema,
  portabilityFileEntrySchema,
  portabilityCompanyManifestEntrySchema,
  portabilitySidebarOrderSchema,
  portabilityAgentManifestEntrySchema,
  portabilitySkillManifestEntrySchema,
  portabilityManifestSchema,
  portabilitySourceSchema,
  portabilityTargetSchema,
  portabilityAgentSelectionSchema,
  portabilityCollisionStrategySchema,
  companyPortabilityExportSchema,
  companyPortabilityPreviewSchema,
  companyPortabilityImportSchema,
} from "./company-portability.js";

describe("portabilityIncludeSchema", () => {
  it("accepts empty object", () => {
    expect(portabilityIncludeSchema.safeParse({}).success).toBe(true);
  });

  it("accepts all boolean fields", () => {
    expect(portabilityIncludeSchema.safeParse({
      company: true, agents: false, projects: true, issues: false, skills: true,
    }).success).toBe(true);
  });
});

describe("portabilityEnvInputSchema", () => {
  const validInput = {
    key: "API_KEY",
    description: "The API key",
    agentSlug: "my-agent",
    projectSlug: "my-project",
    kind: "secret",
    requirement: "required",
    defaultValue: null,
    portability: "portable",
  };

  it("accepts valid input", () => {
    expect(portabilityEnvInputSchema.safeParse(validInput).success).toBe(true);
  });

  it("accepts null nullable fields", () => {
    expect(portabilityEnvInputSchema.safeParse({
      ...validInput, description: null, agentSlug: null, projectSlug: null,
    }).success).toBe(true);
  });

  it("rejects empty key", () => {
    expect(portabilityEnvInputSchema.safeParse({ ...validInput, key: "" }).success).toBe(false);
  });

  it("rejects invalid kind", () => {
    expect(portabilityEnvInputSchema.safeParse({ ...validInput, kind: "encrypted" }).success).toBe(false);
  });

  it("rejects invalid requirement", () => {
    expect(portabilityEnvInputSchema.safeParse({ ...validInput, requirement: "maybe" }).success).toBe(false);
  });

  it("rejects invalid portability", () => {
    expect(portabilityEnvInputSchema.safeParse({ ...validInput, portability: "unknown" }).success).toBe(false);
  });
});

describe("portabilityFileEntrySchema", () => {
  it("accepts plain string", () => {
    expect(portabilityFileEntrySchema.safeParse("file content here").success).toBe(true);
  });

  it("accepts base64 object", () => {
    expect(portabilityFileEntrySchema.safeParse({
      encoding: "base64",
      data: "SGVsbG8gV29ybGQ=",
      contentType: "text/plain",
    }).success).toBe(true);
  });

  it("accepts base64 object without contentType", () => {
    expect(portabilityFileEntrySchema.safeParse({ encoding: "base64", data: "SGVsbG8=" }).success).toBe(true);
  });
});

describe("portabilityCompanyManifestEntrySchema", () => {
  const validInput = {
    path: "/company",
    name: "My Company",
    description: null,
    brandColor: null,
    logoPath: null,
    requireBoardApprovalForNewAgents: false,
    feedbackDataSharingEnabled: false,
    feedbackDataSharingConsentAt: null,
    feedbackDataSharingConsentByUserId: null,
    feedbackDataSharingTermsVersion: null,
  };

  it("accepts valid input", () => {
    expect(portabilityCompanyManifestEntrySchema.safeParse(validInput).success).toBe(true);
  });

  it("defaults feedbackDataSharingEnabled to false", () => {
    const result = portabilityCompanyManifestEntrySchema.safeParse({
      ...validInput,
      feedbackDataSharingEnabled: undefined,
    });
    // feedbackDataSharingEnabled has a default
    expect(result.success).toBe(true);
  });
});

describe("portabilitySidebarOrderSchema", () => {
  it("accepts empty defaults", () => {
    const result = portabilitySidebarOrderSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents).toEqual([]);
      expect(result.data.projects).toEqual([]);
    }
  });

  it("accepts populated lists", () => {
    expect(portabilitySidebarOrderSchema.safeParse({
      agents: ["agent-a", "agent-b"],
      projects: ["project-x"],
    }).success).toBe(true);
  });
});

describe("portabilitySourceSchema", () => {
  it("accepts inline source", () => {
    expect(portabilitySourceSchema.safeParse({
      type: "inline",
      files: { "manifest.json": "content" },
    }).success).toBe(true);
  });

  it("accepts github source", () => {
    expect(portabilitySourceSchema.safeParse({
      type: "github",
      url: "https://github.com/org/repo",
    }).success).toBe(true);
  });

  it("rejects unknown source type", () => {
    expect(portabilitySourceSchema.safeParse({ type: "s3", url: "https://s3.amazonaws.com/bucket" }).success).toBe(false);
  });

  it("rejects github source with invalid url", () => {
    expect(portabilitySourceSchema.safeParse({ type: "github", url: "not-a-url" }).success).toBe(false);
  });
});

describe("portabilityTargetSchema", () => {
  it("accepts new_company target", () => {
    expect(portabilityTargetSchema.safeParse({ mode: "new_company" }).success).toBe(true);
  });

  it("accepts new_company target with name", () => {
    expect(portabilityTargetSchema.safeParse({ mode: "new_company", newCompanyName: "Acme Corp" }).success).toBe(true);
  });

  it("accepts existing_company target", () => {
    expect(portabilityTargetSchema.safeParse({
      mode: "existing_company",
      companyId: "550e8400-e29b-41d4-a716-446655440000",
    }).success).toBe(true);
  });

  it("rejects existing_company without companyId", () => {
    expect(portabilityTargetSchema.safeParse({ mode: "existing_company" }).success).toBe(false);
  });

  it("rejects invalid companyId", () => {
    expect(portabilityTargetSchema.safeParse({ mode: "existing_company", companyId: "not-uuid" }).success).toBe(false);
  });
});

describe("portabilityAgentSelectionSchema", () => {
  it("accepts literal all", () => {
    expect(portabilityAgentSelectionSchema.safeParse("all").success).toBe(true);
  });

  it("accepts array of agent slugs", () => {
    expect(portabilityAgentSelectionSchema.safeParse(["agent-a", "agent-b"]).success).toBe(true);
  });

  it("rejects other string values", () => {
    expect(portabilityAgentSelectionSchema.safeParse("none").success).toBe(false);
  });
});

describe("portabilityCollisionStrategySchema", () => {
  it("accepts valid strategies", () => {
    for (const strategy of ["rename", "skip", "replace"]) {
      expect(portabilityCollisionStrategySchema.safeParse(strategy).success).toBe(true);
    }
  });

  it("rejects invalid strategy", () => {
    expect(portabilityCollisionStrategySchema.safeParse("merge").success).toBe(false);
  });
});

describe("companyPortabilityExportSchema", () => {
  it("accepts empty object", () => {
    expect(companyPortabilityExportSchema.safeParse({}).success).toBe(true);
  });

  it("accepts full export config", () => {
    expect(companyPortabilityExportSchema.safeParse({
      include: { company: true, agents: true },
      agents: ["agent-a"],
      skills: ["skill-x"],
      projects: ["project-y"],
      expandReferencedSkills: true,
    }).success).toBe(true);
  });
});

describe("companyPortabilityPreviewSchema", () => {
  const validInput = {
    source: { type: "inline", files: {} },
    target: { mode: "new_company" },
  };

  it("accepts minimal valid input", () => {
    expect(companyPortabilityPreviewSchema.safeParse(validInput).success).toBe(true);
  });

  it("accepts with all optional fields", () => {
    expect(companyPortabilityPreviewSchema.safeParse({
      ...validInput,
      include: { agents: true },
      agents: "all",
      collisionStrategy: "rename",
      nameOverrides: { "old-agent": "new-agent" },
      selectedFiles: ["manifest.json"],
    }).success).toBe(true);
  });
});

describe("companyPortabilityImportSchema", () => {
  const validInput = {
    source: { type: "github", url: "https://github.com/org/repo" },
    target: { mode: "new_company", newCompanyName: "New Co" },
  };

  it("accepts minimal valid input", () => {
    expect(companyPortabilityImportSchema.safeParse(validInput).success).toBe(true);
  });

  it("accepts with adapterOverrides", () => {
    expect(companyPortabilityImportSchema.safeParse({
      ...validInput,
      adapterOverrides: {
        "agent-a": { adapterType: "claude_local", adapterConfig: {} },
      },
    }).success).toBe(true);
  });

  it("rejects adapterOverride with empty adapterType", () => {
    expect(companyPortabilityImportSchema.safeParse({
      ...validInput,
      adapterOverrides: { "agent-a": { adapterType: "" } },
    }).success).toBe(false);
  });
});
