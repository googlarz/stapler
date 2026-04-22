import { describe, it, expect } from "vitest";
import {
  envBindingPlainSchema,
  envBindingSecretRefSchema,
  envBindingSchema,
  envConfigSchema,
  createSecretSchema,
  rotateSecretSchema,
  updateSecretSchema,
} from "./secret.js";

describe("envBindingPlainSchema", () => {
  it("accepts valid plain binding", () => {
    expect(envBindingPlainSchema.safeParse({ type: "plain", value: "my-value" }).success).toBe(true);
  });

  it("rejects wrong type", () => {
    expect(envBindingPlainSchema.safeParse({ type: "secret_ref", value: "x" }).success).toBe(false);
  });

  it("rejects missing value", () => {
    expect(envBindingPlainSchema.safeParse({ type: "plain" }).success).toBe(false);
  });
});

describe("envBindingSecretRefSchema", () => {
  it("accepts valid secret ref with latest", () => {
    const result = envBindingSecretRefSchema.safeParse({
      type: "secret_ref",
      secretId: "550e8400-e29b-41d4-a716-446655440000",
      version: "latest",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid secret ref with numeric version", () => {
    expect(envBindingSecretRefSchema.safeParse({
      type: "secret_ref",
      secretId: "550e8400-e29b-41d4-a716-446655440000",
      version: 3,
    }).success).toBe(true);
  });

  it("accepts secret ref without version", () => {
    expect(envBindingSecretRefSchema.safeParse({
      type: "secret_ref",
      secretId: "550e8400-e29b-41d4-a716-446655440000",
    }).success).toBe(true);
  });

  it("rejects invalid uuid secretId", () => {
    expect(envBindingSecretRefSchema.safeParse({
      type: "secret_ref",
      secretId: "not-uuid",
    }).success).toBe(false);
  });

  it("rejects zero version", () => {
    expect(envBindingSecretRefSchema.safeParse({
      type: "secret_ref",
      secretId: "550e8400-e29b-41d4-a716-446655440000",
      version: 0,
    }).success).toBe(false);
  });

  it("rejects negative version", () => {
    expect(envBindingSecretRefSchema.safeParse({
      type: "secret_ref",
      secretId: "550e8400-e29b-41d4-a716-446655440000",
      version: -1,
    }).success).toBe(false);
  });
});

describe("envBindingSchema (union)", () => {
  it("accepts plain string (legacy)", () => {
    expect(envBindingSchema.safeParse("plain-value").success).toBe(true);
  });

  it("accepts plain object", () => {
    expect(envBindingSchema.safeParse({ type: "plain", value: "x" }).success).toBe(true);
  });

  it("accepts secret ref object", () => {
    expect(envBindingSchema.safeParse({
      type: "secret_ref",
      secretId: "550e8400-e29b-41d4-a716-446655440000",
    }).success).toBe(true);
  });

  it("rejects number", () => {
    expect(envBindingSchema.safeParse(42).success).toBe(false);
  });
});

describe("envConfigSchema", () => {
  it("accepts record of env bindings", () => {
    expect(envConfigSchema.safeParse({
      API_KEY: "plain-value",
      DB_URL: { type: "plain", value: "postgres://..." },
      SECRET_TOKEN: { type: "secret_ref", secretId: "550e8400-e29b-41d4-a716-446655440000" },
    }).success).toBe(true);
  });

  it("accepts empty object", () => {
    expect(envConfigSchema.safeParse({}).success).toBe(true);
  });
});

describe("createSecretSchema", () => {
  const validInput = { name: "MY_SECRET", value: "secret-value" };

  it("accepts minimal valid input", () => {
    expect(createSecretSchema.safeParse(validInput).success).toBe(true);
  });

  it("accepts all valid providers", () => {
    const providers = ["local_encrypted", "aws_secrets_manager", "gcp_secret_manager", "vault"];
    for (const provider of providers) {
      expect(createSecretSchema.safeParse({ ...validInput, provider }).success).toBe(true);
    }
  });

  it("accepts optional fields", () => {
    expect(createSecretSchema.safeParse({
      ...validInput,
      description: "A description",
      externalRef: "arn:aws:secretsmanager:us-east-1:123:secret:my-secret",
    }).success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(createSecretSchema.safeParse({ ...validInput, name: "" }).success).toBe(false);
  });

  it("rejects empty value", () => {
    expect(createSecretSchema.safeParse({ ...validInput, value: "" }).success).toBe(false);
  });

  it("rejects invalid provider", () => {
    expect(createSecretSchema.safeParse({ ...validInput, provider: "invalid_provider" }).success).toBe(false);
  });
});

describe("rotateSecretSchema", () => {
  it("accepts valid new value", () => {
    expect(rotateSecretSchema.safeParse({ value: "new-secret" }).success).toBe(true);
  });

  it("accepts with externalRef", () => {
    expect(rotateSecretSchema.safeParse({ value: "new-secret", externalRef: "arn:..." }).success).toBe(true);
  });

  it("rejects empty value", () => {
    expect(rotateSecretSchema.safeParse({ value: "" }).success).toBe(false);
  });

  it("rejects missing value", () => {
    expect(rotateSecretSchema.safeParse({}).success).toBe(false);
  });
});

describe("updateSecretSchema", () => {
  it("accepts empty update", () => {
    expect(updateSecretSchema.safeParse({}).success).toBe(true);
  });

  it("accepts name update", () => {
    expect(updateSecretSchema.safeParse({ name: "NEW_NAME" }).success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(updateSecretSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("accepts null description", () => {
    expect(updateSecretSchema.safeParse({ description: null }).success).toBe(true);
  });
});
