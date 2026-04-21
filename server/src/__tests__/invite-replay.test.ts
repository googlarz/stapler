/**
 * Tests for invite replay logic and merge helpers.
 */
import { describe, expect, it } from "vitest";
import {
  canReplayOpenClawGatewayInviteAccept,
  mergeJoinDefaultsPayloadForReplay,
} from "../routes/access.js";

describe("mergeJoinDefaultsPayloadForReplay", () => {
  it("returns nextDefaultsPayload when existing is null", () => {
    const next = { url: "ws://localhost" };
    expect(mergeJoinDefaultsPayloadForReplay(null, next)).toEqual(next);
  });

  it("returns existing when next is null", () => {
    const existing = { url: "ws://localhost" };
    expect(mergeJoinDefaultsPayloadForReplay(existing, null)).toEqual(existing);
  });

  it("returns null when both are null", () => {
    expect(mergeJoinDefaultsPayloadForReplay(null, null)).toBeNull();
  });

  it("merges two plain objects, next wins on conflicts", () => {
    const existing = { url: "ws://old", foo: "bar" };
    const next = { url: "ws://new" };
    const result = mergeJoinDefaultsPayloadForReplay(existing, next) as Record<string, unknown>;
    expect(result.url).toBe("ws://new");
    expect(result.foo).toBe("bar");
  });

  it("deep-merges headers maps", () => {
    const existing = { headers: { "x-old": "a", "x-shared": "old" } };
    const next = { headers: { "x-shared": "new", "x-new": "b" } };
    const result = mergeJoinDefaultsPayloadForReplay(existing, next) as Record<string, unknown>;
    const headers = result.headers as Record<string, string>;
    expect(headers["x-old"]).toBe("a");
    expect(headers["x-shared"]).toBe("new"); // next wins
    expect(headers["x-new"]).toBe("b");
  });

  it("does not add empty headers key when neither payload has headers", () => {
    const result = mergeJoinDefaultsPayloadForReplay({ a: 1 }, { b: 2 }) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(result, "headers")).toBe(false);
  });

  it("handles non-object existing with plain object next", () => {
    const next = { url: "ws://new" };
    const result = mergeJoinDefaultsPayloadForReplay("string-value", next);
    expect(result).toEqual(next);
  });
});

describe("canReplayOpenClawGatewayInviteAccept", () => {
  const validGatewayRequest = {
    requestType: "agent" as const,
    adapterType: "openclaw_gateway",
    status: "pending_approval",
  };

  it("returns true for pending_approval openclaw_gateway agent re-join", () => {
    expect(
      canReplayOpenClawGatewayInviteAccept({
        requestType: "agent",
        adapterType: "openclaw_gateway",
        existingJoinRequest: validGatewayRequest,
      }),
    ).toBe(true);
  });

  it("returns true for approved openclaw_gateway agent re-join", () => {
    expect(
      canReplayOpenClawGatewayInviteAccept({
        requestType: "agent",
        adapterType: "openclaw_gateway",
        existingJoinRequest: { ...validGatewayRequest, status: "approved" },
      }),
    ).toBe(true);
  });

  it("returns false when requestType is human", () => {
    expect(
      canReplayOpenClawGatewayInviteAccept({
        requestType: "human",
        adapterType: "openclaw_gateway",
        existingJoinRequest: validGatewayRequest,
      }),
    ).toBe(false);
  });

  it("returns false when adapterType is not openclaw_gateway", () => {
    expect(
      canReplayOpenClawGatewayInviteAccept({
        requestType: "agent",
        adapterType: "process",
        existingJoinRequest: validGatewayRequest,
      }),
    ).toBe(false);
  });

  it("returns false when no existing join request", () => {
    expect(
      canReplayOpenClawGatewayInviteAccept({
        requestType: "agent",
        adapterType: "openclaw_gateway",
        existingJoinRequest: null,
      }),
    ).toBe(false);
  });

  it("returns false when existing request is a human join", () => {
    expect(
      canReplayOpenClawGatewayInviteAccept({
        requestType: "agent",
        adapterType: "openclaw_gateway",
        existingJoinRequest: {
          ...validGatewayRequest,
          requestType: "human",
        },
      }),
    ).toBe(false);
  });

  it("returns false when existing request is not openclaw_gateway", () => {
    expect(
      canReplayOpenClawGatewayInviteAccept({
        requestType: "agent",
        adapterType: "openclaw_gateway",
        existingJoinRequest: {
          ...validGatewayRequest,
          adapterType: "process",
        },
      }),
    ).toBe(false);
  });

  it("returns false when existing request status is rejected", () => {
    expect(
      canReplayOpenClawGatewayInviteAccept({
        requestType: "agent",
        adapterType: "openclaw_gateway",
        existingJoinRequest: {
          ...validGatewayRequest,
          status: "rejected",
        },
      }),
    ).toBe(false);
  });
});
