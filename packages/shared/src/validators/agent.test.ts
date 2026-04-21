import { describe, expect, it } from "vitest";
import {
  agentMemoryTagsSchema,
  agentPermissionsSchema,
  createAgentMemorySchema,
  createAgentSchema,
  createSecretSchema,
  envBindingSchema,
  envConfigSchema,
  listAgentMemoriesQuerySchema,
  rotateSecretSchema,
  updateAgentSchema,
  updateSecretSchema,
  wakeAgentSchema,
} from "./index.js";

// ──────────────────────────────────────────────────────────
// agentPermissionsSchema
// ──────────────────────────────────────────────────────────

describe("agentPermissionsSchema", () => {
  it("defaults canCreateAgents to false", () => {
    const r = agentPermissionsSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.canCreateAgents).toBe(false);
  });

  it("accepts canCreateAgents: true", () => {
    expect(agentPermissionsSchema.safeParse({ canCreateAgents: true }).success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// createAgentSchema
// ──────────────────────────────────────────────────────────

describe("createAgentSchema", () => {
  const valid = {
    name: "My Agent",
    adapterType: "openclaw_gateway",
  };

  it("accepts minimal valid agent", () => {
    const r = createAgentSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.role).toBe("general");
      expect(r.data.adapterConfig).toEqual({});
      expect(r.data.runtimeConfig).toEqual({});
      expect(r.data.budgetMonthlyCents).toBe(0);
    }
  });

  it("rejects empty name", () => {
    expect(createAgentSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("rejects empty adapterType", () => {
    expect(createAgentSchema.safeParse({ ...valid, adapterType: "" }).success).toBe(false);
  });

  it("rejects invalid role", () => {
    expect(createAgentSchema.safeParse({ ...valid, role: "janitor" }).success).toBe(false);
  });

  it("rejects non-UUID reportsTo", () => {
    expect(createAgentSchema.safeParse({ ...valid, reportsTo: "not-uuid" }).success).toBe(false);
  });

  it("accepts null reportsTo", () => {
    expect(createAgentSchema.safeParse({ ...valid, reportsTo: null }).success).toBe(true);
  });

  it("rejects negative budget", () => {
    expect(createAgentSchema.safeParse({ ...valid, budgetMonthlyCents: -1 }).success).toBe(false);
  });

  it("accepts process adapterType", () => {
    expect(createAgentSchema.safeParse({ ...valid, adapterType: "process" }).success).toBe(true);
  });

  it("validates adapterConfig.env via envConfigSchema", () => {
    const withBadEnv = {
      ...valid,
      adapterConfig: { env: { KEY: { type: "unknown_type", value: "v" } } },
    };
    expect(createAgentSchema.safeParse(withBadEnv).success).toBe(false);
  });

  it("accepts adapterConfig.env with plain string binding", () => {
    const withEnv = {
      ...valid,
      adapterConfig: { env: { KEY: "plain-value" } },
    };
    expect(createAgentSchema.safeParse(withEnv).success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// updateAgentSchema
// ──────────────────────────────────────────────────────────

describe("updateAgentSchema", () => {
  it("accepts empty patch", () => {
    expect(updateAgentSchema.safeParse({}).success).toBe(true);
  });

  it("accepts valid status in partial update", () => {
    expect(updateAgentSchema.safeParse({ status: "paused" }).success).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(updateAgentSchema.safeParse({ status: "deleted" }).success).toBe(false);
  });

  it("rejects fractional spentMonthlyCents", () => {
    expect(updateAgentSchema.safeParse({ spentMonthlyCents: 1.5 }).success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// wakeAgentSchema
// ──────────────────────────────────────────────────────────

describe("wakeAgentSchema", () => {
  it("defaults source to on_demand", () => {
    const r = wakeAgentSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.source).toBe("on_demand");
  });

  it("defaults forceFreshSession to false", () => {
    const r = wakeAgentSchema.safeParse({});
    if (r.success) expect(r.data.forceFreshSession).toBe(false);
  });

  it("coerces null forceFreshSession to false", () => {
    const r = wakeAgentSchema.safeParse({ forceFreshSession: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.forceFreshSession).toBe(false);
  });

  it("rejects invalid source", () => {
    expect(wakeAgentSchema.safeParse({ source: "magic" }).success).toBe(false);
  });

  it("rejects invalid triggerDetail", () => {
    expect(wakeAgentSchema.safeParse({ triggerDetail: "auto" }).success).toBe(false);
  });

  it("accepts valid triggerDetail manual", () => {
    expect(wakeAgentSchema.safeParse({ triggerDetail: "manual" }).success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// envBindingSchema / envConfigSchema
// ──────────────────────────────────────────────────────────

describe("envBindingSchema", () => {
  it("accepts plain string", () => {
    expect(envBindingSchema.safeParse("value").success).toBe(true);
  });

  it("accepts plain object binding", () => {
    expect(envBindingSchema.safeParse({ type: "plain", value: "v" }).success).toBe(true);
  });

  it("accepts secret_ref binding with UUID secretId", () => {
    expect(envBindingSchema.safeParse({
      type: "secret_ref",
      secretId: "550e8400-e29b-41d4-a716-446655440000",
    }).success).toBe(true);
  });

  it("rejects secret_ref with non-UUID secretId", () => {
    expect(envBindingSchema.safeParse({
      type: "secret_ref",
      secretId: "not-a-uuid",
    }).success).toBe(false);
  });

  it("accepts secret_ref with version latest", () => {
    expect(envBindingSchema.safeParse({
      type: "secret_ref",
      secretId: "550e8400-e29b-41d4-a716-446655440000",
      version: "latest",
    }).success).toBe(true);
  });

  it("accepts secret_ref with numeric version", () => {
    expect(envBindingSchema.safeParse({
      type: "secret_ref",
      secretId: "550e8400-e29b-41d4-a716-446655440000",
      version: 3,
    }).success).toBe(true);
  });
});

describe("envConfigSchema", () => {
  it("accepts a map of string values", () => {
    expect(envConfigSchema.safeParse({ FOO: "bar", BAZ: "qux" }).success).toBe(true);
  });

  it("accepts mixed binding types", () => {
    expect(envConfigSchema.safeParse({
      PLAIN: "value",
      REF: { type: "secret_ref", secretId: "550e8400-e29b-41d4-a716-446655440000" },
    }).success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// createSecretSchema / rotateSecretSchema / updateSecretSchema
// ──────────────────────────────────────────────────────────

describe("createSecretSchema", () => {
  const valid = { name: "MY_SECRET", value: "secret-value" };

  it("accepts minimal valid secret", () => {
    expect(createSecretSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(createSecretSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("rejects empty value", () => {
    expect(createSecretSchema.safeParse({ ...valid, value: "" }).success).toBe(false);
  });
});

describe("rotateSecretSchema", () => {
  it("accepts valid rotation", () => {
    expect(rotateSecretSchema.safeParse({ value: "new-value" }).success).toBe(true);
  });

  it("rejects empty value", () => {
    expect(rotateSecretSchema.safeParse({ value: "" }).success).toBe(false);
  });
});

describe("updateSecretSchema", () => {
  it("accepts empty patch", () => {
    expect(updateSecretSchema.safeParse({}).success).toBe(true);
  });

  it("accepts name update only", () => {
    expect(updateSecretSchema.safeParse({ name: "NEW_NAME" }).success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(updateSecretSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// agentMemoryTagsSchema / createAgentMemorySchema / listAgentMemoriesQuerySchema
// ──────────────────────────────────────────────────────────

describe("agentMemoryTagsSchema", () => {
  it("accepts valid tags", () => {
    const r = agentMemoryTagsSchema.safeParse(["feature", "sprint-42", "v1.0"]);
    expect(r.success).toBe(true);
  });

  it("deduplicates tags", () => {
    const r = agentMemoryTagsSchema.safeParse(["a", "b", "a"]);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual(["a", "b"]);
  });

  it("rejects empty string tag", () => {
    expect(agentMemoryTagsSchema.safeParse([""]).success).toBe(false);
  });

  it("rejects tag with forbidden characters", () => {
    expect(agentMemoryTagsSchema.safeParse(["tag with spaces"]).success).toBe(false);
  });

  it("rejects tag exceeding max length", () => {
    expect(agentMemoryTagsSchema.safeParse(["x".repeat(65)]).success).toBe(false);
  });

  it("rejects more than 16 tags", () => {
    expect(agentMemoryTagsSchema.safeParse(Array.from({ length: 17 }, (_, i) => `tag${i}`)).success).toBe(false);
  });
});

describe("createAgentMemorySchema", () => {
  it("accepts minimal valid memory", () => {
    expect(createAgentMemorySchema.safeParse({ content: "Remember this" }).success).toBe(true);
  });

  it("rejects empty content", () => {
    expect(createAgentMemorySchema.safeParse({ content: "" }).success).toBe(false);
  });

  it("rejects content exceeding 4096 chars", () => {
    expect(createAgentMemorySchema.safeParse({ content: "x".repeat(4097) }).success).toBe(false);
  });

  it("rejects expiresAt in the past", () => {
    const r = createAgentMemorySchema.safeParse({
      content: "test",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(r.success).toBe(false);
  });

  it("accepts future expiresAt", () => {
    const r = createAgentMemorySchema.safeParse({
      content: "test",
      expiresAt: new Date(Date.now() + 86400_000).toISOString(),
    });
    expect(r.success).toBe(true);
  });

  it("rejects non-ISO expiresAt", () => {
    expect(createAgentMemorySchema.safeParse({ content: "test", expiresAt: "not-a-date" }).success).toBe(false);
  });
});

describe("listAgentMemoriesQuerySchema", () => {
  it("accepts empty query", () => {
    expect(listAgentMemoriesQuerySchema.safeParse({}).success).toBe(true);
  });

  it("accepts valid q and limit", () => {
    expect(listAgentMemoriesQuerySchema.safeParse({ q: "search term", limit: "10" }).success).toBe(true);
  });

  it("rejects extra unknown keys (strict)", () => {
    expect(listAgentMemoriesQuerySchema.safeParse({ unknown: "field" }).success).toBe(false);
  });

  it("rejects q exceeding 512 chars", () => {
    expect(listAgentMemoriesQuerySchema.safeParse({ q: "x".repeat(513) }).success).toBe(false);
  });

  it("coerces limit from string to number", () => {
    const r = listAgentMemoriesQuerySchema.safeParse({ limit: "5" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(5);
  });

  it("rejects limit over 100", () => {
    expect(listAgentMemoriesQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("splits tags by comma", () => {
    const r = listAgentMemoriesQuerySchema.safeParse({ tags: "a,b,c" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tags).toEqual(["a", "b", "c"]);
  });
});
