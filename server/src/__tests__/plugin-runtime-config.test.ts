/**
 * Unit tests for the plugin runtime config service.
 *
 * Tests the pure validation helpers and the service layer logic
 * using a fake DB where needed.
 */

import { describe, expect, it } from "vitest";
import {
  validateReservedKeys,
  RESERVED_KEYS,
  MAX_CONFIG_BYTES,
} from "../services/plugin-runtime-config.js";

// ── validateReservedKeys ──────────────────────────────────────────────────────

describe("validateReservedKeys", () => {
  it("accepts regular keys without throwing", () => {
    expect(() => validateReservedKeys({ foo: "bar", baz: 123 })).not.toThrow();
  });

  it("throws on empty-string key", () => {
    expect(() => validateReservedKeys({ "": "value" })).toThrow(/reserved.*empty/i);
  });

  it("throws on __proto__ key (computed property avoids JS engine prototype-setting)", () => {
    // Using computed property syntax ensures the key is enumerable and visible to Object.keys()
    const obj = Object.fromEntries([["__proto__", "bad"]]);
    expect(() => validateReservedKeys(obj)).toThrow(/__proto__/);
  });

  it("throws on constructor key", () => {
    expect(() => validateReservedKeys({ constructor: "bad" })).toThrow(/constructor/);
  });

  it("throws on prototype key", () => {
    expect(() => validateReservedKeys({ prototype: "bad" })).toThrow(/prototype/);
  });

  it("throws on key starting with a dot", () => {
    expect(() => validateReservedKeys({ ".hidden": "value" })).toThrow(/dot/i);
  });

  it("throws on key ending with a dot", () => {
    expect(() => validateReservedKeys({ "trailing.": "value" })).toThrow(/dot/i);
  });

  it("allows keys that contain a dot in the middle", () => {
    expect(() => validateReservedKeys({ "a.b": "value" })).not.toThrow();
  });

  it("RESERVED_KEYS list is frozen and non-empty", () => {
    expect(RESERVED_KEYS.length).toBeGreaterThan(0);
    expect(Object.isFrozen(RESERVED_KEYS)).toBe(true);
  });
});

// ── MAX_CONFIG_BYTES ──────────────────────────────────────────────────────────

describe("MAX_CONFIG_BYTES", () => {
  it("is 64 KiB", () => {
    expect(MAX_CONFIG_BYTES).toBe(65536);
  });
});

// ── createPluginRuntimeConfigService — unit tests with fake DB ────────────────

async function makeService(opts: {
  existingRow?: { configJson: Record<string, unknown>; revision: bigint } | null;
  insertReturning?: { revision: bigint }[];
  updateReturning?: { revision: bigint }[];
} = {}) {
  const {
    existingRow = null,
    insertReturning = [{ revision: 1n }],
    updateReturning = [{ revision: 2n }],
  } = opts;

  const db = {
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => Promise.resolve(existingRow ? [existingRow] : []),
      }),
    }),
    insert: (_table: unknown) => ({
      values: (_vals: unknown) => ({
        onConflictDoUpdate: (_opts: unknown) => ({
          returning: (_fields: unknown) => Promise.resolve(insertReturning),
        }),
      }),
    }),
    update: (_table: unknown) => ({
      set: (_vals: unknown) => ({
        where: (_cond: unknown) => ({
          returning: (_fields: unknown) => Promise.resolve(updateReturning),
        }),
      }),
    }),
  } as any;

  const { createPluginRuntimeConfigService } = await import("../services/plugin-runtime-config.js");
  return createPluginRuntimeConfigService(db);
}

describe("createPluginRuntimeConfigService", () => {

  describe("getRuntime", () => {
    it("returns empty values and revision 0 when no row exists", async () => {
      const svc = await makeService({ existingRow: null });
      const result = await svc.getRuntime("plugin-1");
      expect(result).toEqual({ values: {}, revision: "0" });
    });

    it("returns values and revision from existing row", async () => {
      const svc = await makeService({
        existingRow: { configJson: { apiKey: "abc" }, revision: 5n },
      });
      const result = await svc.getRuntime("plugin-1");
      expect(result.values).toEqual({ apiKey: "abc" });
      expect(result.revision).toBe("5");
    });
  });

  describe("setRuntime", () => {
    it("throws when patch is empty", async () => {
      const svc = await makeService();
      await expect(svc.setRuntime("plugin-1", {})).rejects.toThrow(/empty/i);
    });

    it("throws when patch contains reserved key", async () => {
      const svc = await makeService();
      await expect(svc.setRuntime("plugin-1", { __proto__: "bad" })).rejects.toThrow();
    });

    it("returns revision string from DB on success", async () => {
      const svc = await makeService({ insertReturning: [{ revision: 3n }] });
      const result = await svc.setRuntime("plugin-1", { token: "xyz" });
      expect(result.revision).toBe("3");
    });

    it("throws when merged config exceeds MAX_CONFIG_BYTES", async () => {
      // Build a patch with ~70 KB of data to exceed the 64 KiB limit
      const bigValue = "x".repeat(70_000);
      const svc = await makeService();
      await expect(svc.setRuntime("plugin-1", { big: bigValue })).rejects.toThrow(
        /size limit/i,
      );
    });
  });

  describe("unsetRuntime", () => {
    it("returns revision 0 when no config exists (no-op)", async () => {
      const svc = await makeService({ existingRow: null });
      const result = await svc.unsetRuntime("plugin-1", "missingKey");
      expect(result.revision).toBe("0");
    });

    it("returns existing revision unchanged when key is not present", async () => {
      const svc = await makeService({
        existingRow: { configJson: { other: "value" }, revision: 4n },
      });
      const result = await svc.unsetRuntime("plugin-1", "notPresent");
      expect(result.revision).toBe("4");
    });

    it("calls DB update and returns new revision when key exists", async () => {
      const svc = await makeService({
        existingRow: { configJson: { token: "abc", other: "keep" }, revision: 2n },
        updateReturning: [{ revision: 3n }],
      });
      const result = await svc.unsetRuntime("plugin-1", "token");
      expect(result.revision).toBe("3");
    });

    it("throws on reserved key", async () => {
      const svc = await makeService({
        existingRow: { configJson: {}, revision: 1n },
      });
      await expect(svc.unsetRuntime("plugin-1", "__proto__")).rejects.toThrow();
    });
  });
});
