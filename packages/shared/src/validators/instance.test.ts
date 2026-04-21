/**
 * Tests for instance settings validators.
 */
import { describe, expect, it } from "vitest";
import {
  backupRetentionPolicySchema,
  instanceGeneralSettingsSchema,
  instanceExperimentalSettingsSchema,
  patchInstanceGeneralSettingsSchema,
  patchInstanceExperimentalSettingsSchema,
} from "./instance.js";

// ──────────────────────────────────────────────────────────
// backupRetentionPolicySchema
// ──────────────────────────────────────────────────────────

describe("backupRetentionPolicySchema", () => {
  it("accepts valid preset values", () => {
    expect(
      backupRetentionPolicySchema.safeParse({
        dailyDays: 7,
        weeklyWeeks: 2,
        monthlyMonths: 3,
      }).success,
    ).toBe(true);
  });

  it("rejects dailyDays not in presets", () => {
    expect(
      backupRetentionPolicySchema.safeParse({
        dailyDays: 5,
        weeklyWeeks: 2,
        monthlyMonths: 3,
      }).success,
    ).toBe(false);
  });

  it("rejects weeklyWeeks not in presets", () => {
    expect(
      backupRetentionPolicySchema.safeParse({
        dailyDays: 7,
        weeklyWeeks: 3,
        monthlyMonths: 3,
      }).success,
    ).toBe(false);
  });

  it("accepts all valid dailyDays presets", () => {
    for (const v of [3, 7, 14]) {
      expect(
        backupRetentionPolicySchema.safeParse({ dailyDays: v, weeklyWeeks: 1, monthlyMonths: 1 })
          .success,
        `dailyDays=${v}`,
      ).toBe(true);
    }
  });

  it("accepts all valid weeklyWeeks presets", () => {
    for (const v of [1, 2, 4]) {
      expect(
        backupRetentionPolicySchema.safeParse({ dailyDays: 3, weeklyWeeks: v, monthlyMonths: 1 })
          .success,
        `weeklyWeeks=${v}`,
      ).toBe(true);
    }
  });

  it("accepts all valid monthlyMonths presets", () => {
    for (const v of [1, 3, 6]) {
      expect(
        backupRetentionPolicySchema.safeParse({ dailyDays: 3, weeklyWeeks: 1, monthlyMonths: v })
          .success,
        `monthlyMonths=${v}`,
      ).toBe(true);
    }
  });
});

// ──────────────────────────────────────────────────────────
// instanceGeneralSettingsSchema
// ──────────────────────────────────────────────────────────

describe("instanceGeneralSettingsSchema", () => {
  it("applies defaults for empty object", () => {
    const r = instanceGeneralSettingsSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.censorUsernameInLogs).toBe(false);
      expect(r.data.keyboardShortcuts).toBe(false);
      expect(r.data.backupRetention).toBeDefined();
    }
  });

  it("accepts censorUsernameInLogs=true", () => {
    expect(
      instanceGeneralSettingsSchema.safeParse({ censorUsernameInLogs: true }).success,
    ).toBe(true);
  });

  it("rejects unknown keys (strict)", () => {
    expect(
      instanceGeneralSettingsSchema.safeParse({ unknownSetting: true }).success,
    ).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// patchInstanceGeneralSettingsSchema
// ──────────────────────────────────────────────────────────

describe("patchInstanceGeneralSettingsSchema", () => {
  it("accepts empty patch", () => {
    expect(patchInstanceGeneralSettingsSchema.safeParse({}).success).toBe(true);
  });

  it("accepts partial update with one field", () => {
    expect(
      patchInstanceGeneralSettingsSchema.safeParse({ keyboardShortcuts: true }).success,
    ).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// instanceExperimentalSettingsSchema
// ──────────────────────────────────────────────────────────

describe("instanceExperimentalSettingsSchema", () => {
  it("applies false defaults", () => {
    const r = instanceExperimentalSettingsSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.enableIsolatedWorkspaces).toBe(false);
      expect(r.data.autoRestartDevServerWhenIdle).toBe(false);
    }
  });

  it("rejects unknown keys (strict)", () => {
    expect(
      instanceExperimentalSettingsSchema.safeParse({ featureX: true }).success,
    ).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// patchInstanceExperimentalSettingsSchema
// ──────────────────────────────────────────────────────────

describe("patchInstanceExperimentalSettingsSchema", () => {
  it("accepts empty patch", () => {
    expect(patchInstanceExperimentalSettingsSchema.safeParse({}).success).toBe(true);
  });

  it("accepts enabling isolated workspaces", () => {
    expect(
      patchInstanceExperimentalSettingsSchema.safeParse({ enableIsolatedWorkspaces: true }).success,
    ).toBe(true);
  });
});
