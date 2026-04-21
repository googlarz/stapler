/**
 * Tests for company document validators.
 */
import { describe, expect, it } from "vitest";
import {
  createCompanyDocumentSchema,
  restoreCompanyDocumentRevisionSchema,
  updateCompanyDocumentSchema,
} from "./index.js";

const valid = {
  title: "Product Spec",
  format: "markdown",
  body: "# Hello",
};

// ──────────────────────────────────────────────────────────
// createCompanyDocumentSchema
// ──────────────────────────────────────────────────────────

describe("createCompanyDocumentSchema", () => {
  it("accepts minimal valid document", () => {
    expect(createCompanyDocumentSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty title", () => {
    expect(createCompanyDocumentSchema.safeParse({ ...valid, title: "" }).success).toBe(false);
  });

  it("rejects title over 200 chars", () => {
    expect(
      createCompanyDocumentSchema.safeParse({ ...valid, title: "t".repeat(201) }).success,
    ).toBe(false);
  });

  it("rejects invalid format", () => {
    expect(
      createCompanyDocumentSchema.safeParse({ ...valid, format: "html" }).success,
    ).toBe(false);
  });

  it("rejects format=plaintext (only markdown supported)", () => {
    expect(
      createCompanyDocumentSchema.safeParse({ ...valid, format: "plaintext" }).success,
    ).toBe(false);
  });

  it("rejects body over 524288 chars", () => {
    expect(
      createCompanyDocumentSchema.safeParse({ ...valid, body: "x".repeat(524289) }).success,
    ).toBe(false);
  });

  it("accepts body exactly at 524288 chars", () => {
    expect(
      createCompanyDocumentSchema.safeParse({ ...valid, body: "x".repeat(524288) }).success,
    ).toBe(true);
  });

  it("rejects changeSummary over 500 chars", () => {
    expect(
      createCompanyDocumentSchema.safeParse({ ...valid, changeSummary: "s".repeat(501) }).success,
    ).toBe(false);
  });

  it("accepts null changeSummary", () => {
    expect(
      createCompanyDocumentSchema.safeParse({ ...valid, changeSummary: null }).success,
    ).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// updateCompanyDocumentSchema
// ──────────────────────────────────────────────────────────

describe("updateCompanyDocumentSchema", () => {
  it("accepts full update without baseRevisionId", () => {
    expect(updateCompanyDocumentSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts baseRevisionId as UUID", () => {
    expect(
      updateCompanyDocumentSchema.safeParse({
        ...valid,
        baseRevisionId: "550e8400-e29b-41d4-a716-446655440000",
      }).success,
    ).toBe(true);
  });

  it("rejects baseRevisionId as non-UUID", () => {
    expect(
      updateCompanyDocumentSchema.safeParse({ ...valid, baseRevisionId: "rev-1" }).success,
    ).toBe(false);
  });

  it("accepts null baseRevisionId", () => {
    expect(
      updateCompanyDocumentSchema.safeParse({ ...valid, baseRevisionId: null }).success,
    ).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// restoreCompanyDocumentRevisionSchema
// ──────────────────────────────────────────────────────────

describe("restoreCompanyDocumentRevisionSchema", () => {
  it("accepts empty object", () => {
    expect(restoreCompanyDocumentRevisionSchema.safeParse({}).success).toBe(true);
  });
});
