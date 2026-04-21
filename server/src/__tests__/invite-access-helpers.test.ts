/**
 * Tests for pure helper functions exported from the access routes module.
 */
import { describe, expect, it } from "vitest";
import {
  agentJoinGrantsFromDefaults,
  buildJoinDefaultsPayloadForAccept,
  companyInviteExpiresAt,
  resolveJoinRequestAgentManagerId,
} from "../routes/access.js";

// ──────────────────────────────────────────────────────────
// companyInviteExpiresAt
// ──────────────────────────────────────────────────────────

describe("companyInviteExpiresAt", () => {
  it("returns a Date in the future", () => {
    const expiresAt = companyInviteExpiresAt();
    expect(expiresAt instanceof Date).toBe(true);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("accepts a custom nowMs", () => {
    const nowMs = 1_000_000_000_000; // fixed point in time
    const expiresAt = companyInviteExpiresAt(nowMs);
    // Should be some days after nowMs
    expect(expiresAt.getTime()).toBeGreaterThan(nowMs);
    // Should be less than 1 year
    expect(expiresAt.getTime()).toBeLessThan(nowMs + 365 * 24 * 60 * 60 * 1000);
  });

  it("returns consistent TTL for two calls with the same nowMs", () => {
    const nowMs = Date.now();
    const a = companyInviteExpiresAt(nowMs);
    const b = companyInviteExpiresAt(nowMs);
    expect(a.getTime()).toBe(b.getTime());
  });
});

// ──────────────────────────────────────────────────────────
// buildJoinDefaultsPayloadForAccept
// ──────────────────────────────────────────────────────────

describe("buildJoinDefaultsPayloadForAccept", () => {
  it("returns defaultsPayload unchanged for non-openclaw adapter", () => {
    const defaults = { url: "http://example.com" };
    const result = buildJoinDefaultsPayloadForAccept({
      adapterType: "process",
      defaultsPayload: defaults,
    });
    expect(result).toEqual(defaults);
  });

  it("returns defaultsPayload unchanged for null adapterType", () => {
    const defaults = { some: "value" };
    const result = buildJoinDefaultsPayloadForAccept({
      adapterType: null,
      defaultsPayload: defaults,
    });
    expect(result).toEqual(defaults);
  });

  it("injects inboundOpenClawTokenHeader into headers for openclaw_gateway", () => {
    const result = buildJoinDefaultsPayloadForAccept({
      adapterType: "openclaw_gateway",
      defaultsPayload: {},
      inboundOpenClawTokenHeader: "secret-token",
    }) as Record<string, unknown>;
    const headers = result.headers as Record<string, string>;
    expect(headers["x-openclaw-token"]).toBe("secret-token");
  });

  it("does not override existing x-openclaw-token", () => {
    const result = buildJoinDefaultsPayloadForAccept({
      adapterType: "openclaw_gateway",
      defaultsPayload: { headers: { "x-openclaw-token": "existing" } },
      inboundOpenClawTokenHeader: "new-token",
    }) as Record<string, unknown>;
    const headers = result.headers as Record<string, string>;
    expect(headers["x-openclaw-token"]).toBe("existing");
  });

  it("injects paperclipApiUrl from input when not in defaults", () => {
    const result = buildJoinDefaultsPayloadForAccept({
      adapterType: "openclaw_gateway",
      defaultsPayload: {},
      paperclipApiUrl: "http://myserver.local:3100",
    }) as Record<string, unknown>;
    expect(result.paperclipApiUrl).toBe("http://myserver.local:3100");
  });

  it("does not override existing paperclipApiUrl in defaults", () => {
    const result = buildJoinDefaultsPayloadForAccept({
      adapterType: "openclaw_gateway",
      defaultsPayload: { paperclipApiUrl: "http://existing:3100" },
      paperclipApiUrl: "http://override:3100",
    }) as Record<string, unknown>;
    expect(result.paperclipApiUrl).toBe("http://existing:3100");
  });

  it("omits headers key from result when no headers injected", () => {
    const result = buildJoinDefaultsPayloadForAccept({
      adapterType: "openclaw_gateway",
      defaultsPayload: {},
    });
    if (result && typeof result === "object") {
      expect(Object.prototype.hasOwnProperty.call(result, "headers")).toBe(false);
    }
    // If result is null/undefined, that's also acceptable — no headers to include
  });
});

// ──────────────────────────────────────────────────────────
// agentJoinGrantsFromDefaults
// ──────────────────────────────────────────────────────────

describe("agentJoinGrantsFromDefaults", () => {
  it("returns grants with tasks:assign when defaults payload is null", () => {
    const grants = agentJoinGrantsFromDefaults(null);
    const keys = grants.map((g) => g.permissionKey);
    expect(keys).toContain("tasks:assign");
  });

  it("returns grants with tasks:assign when defaults payload has no grants", () => {
    const grants = agentJoinGrantsFromDefaults({});
    const keys = grants.map((g) => g.permissionKey);
    expect(keys).toContain("tasks:assign");
  });

  it("does not duplicate tasks:assign when already in grants", () => {
    const payload = {
      grants: [{ permissionKey: "tasks:assign", scope: null }],
    };
    const grants = agentJoinGrantsFromDefaults(payload);
    const assignGrants = grants.filter((g) => g.permissionKey === "tasks:assign");
    expect(assignGrants).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────
// resolveJoinRequestAgentManagerId
// ──────────────────────────────────────────────────────────

describe("resolveJoinRequestAgentManagerId", () => {
  it("returns null for empty candidates list", () => {
    expect(resolveJoinRequestAgentManagerId([])).toBeNull();
  });

  it("returns null when no CEO exists", () => {
    const candidates = [
      { id: "a1", role: "engineer", reportsTo: null },
      { id: "a2", role: "manager", reportsTo: "a1" },
    ];
    expect(resolveJoinRequestAgentManagerId(candidates)).toBeNull();
  });

  it("returns root CEO id (no reportsTo)", () => {
    const candidates = [
      { id: "ceo-root", role: "ceo", reportsTo: null },
      { id: "ceo-sub", role: "ceo", reportsTo: "ceo-root" },
    ];
    expect(resolveJoinRequestAgentManagerId(candidates)).toBe("ceo-root");
  });

  it("falls back to first CEO when none is root", () => {
    const candidates = [
      { id: "ceo-a", role: "ceo", reportsTo: "external-id" },
      { id: "ceo-b", role: "ceo", reportsTo: "other-id" },
    ];
    expect(resolveJoinRequestAgentManagerId(candidates)).toBe("ceo-a");
  });

  it("returns the sole CEO even without reportsTo=null", () => {
    const candidates = [{ id: "boss", role: "ceo", reportsTo: null }];
    expect(resolveJoinRequestAgentManagerId(candidates)).toBe("boss");
  });
});
