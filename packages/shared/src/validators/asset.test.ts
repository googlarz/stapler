import { describe, it, expect } from "vitest";
import { createAssetImageMetadataSchema } from "./asset.js";

describe("createAssetImageMetadataSchema", () => {
  describe("valid cases", () => {
    it("accepts undefined (namespace is optional)", () => {
      const result = createAssetImageMetadataSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts a simple alphanumeric namespace", () => {
      const result = createAssetImageMetadataSchema.safeParse({ namespace: "myapp" });
      expect(result.success).toBe(true);
      expect(result.data?.namespace).toBe("myapp");
    });

    it("accepts namespace with slashes and dashes", () => {
      const result = createAssetImageMetadataSchema.safeParse({ namespace: "org/repo-name_v1" });
      expect(result.success).toBe(true);
    });

    it("accepts namespace at max length (120 chars)", () => {
      const ns = "a".repeat(120);
      const result = createAssetImageMetadataSchema.safeParse({ namespace: ns });
      expect(result.success).toBe(true);
    });

    it("trims leading/trailing whitespace", () => {
      const result = createAssetImageMetadataSchema.safeParse({ namespace: "  hello  " });
      expect(result.success).toBe(true);
      expect(result.data?.namespace).toBe("hello");
    });
  });

  describe("invalid cases", () => {
    it("rejects namespace with spaces", () => {
      const result = createAssetImageMetadataSchema.safeParse({ namespace: "my namespace" });
      expect(result.success).toBe(false);
    });

    it("rejects namespace with special characters", () => {
      const result = createAssetImageMetadataSchema.safeParse({ namespace: "foo@bar" });
      expect(result.success).toBe(false);
    });

    it("rejects namespace exceeding 120 characters", () => {
      const ns = "a".repeat(121);
      const result = createAssetImageMetadataSchema.safeParse({ namespace: ns });
      expect(result.success).toBe(false);
    });

    it("rejects empty string namespace (after trim)", () => {
      const result = createAssetImageMetadataSchema.safeParse({ namespace: "   " });
      expect(result.success).toBe(false);
    });

    it("rejects non-string namespace", () => {
      const result = createAssetImageMetadataSchema.safeParse({ namespace: 42 });
      expect(result.success).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("accepts single character namespace", () => {
      const result = createAssetImageMetadataSchema.safeParse({ namespace: "a" });
      expect(result.success).toBe(true);
    });

    it("accepts namespace with only underscores", () => {
      const result = createAssetImageMetadataSchema.safeParse({ namespace: "___" });
      expect(result.success).toBe(true);
    });

    it("accepts namespace with mixed allowed characters", () => {
      const result = createAssetImageMetadataSchema.safeParse({ namespace: "Org/My-App_2024" });
      expect(result.success).toBe(true);
    });

    it("rejects dot in namespace", () => {
      const result = createAssetImageMetadataSchema.safeParse({ namespace: "my.app" });
      expect(result.success).toBe(false);
    });
  });
});
