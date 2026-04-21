import { describe, expect, it } from "vitest";
import {
  inferBindModeFromHost,
  isAllInterfacesHost,
  isLoopbackHost,
  resolveRuntimeBind,
  validateConfiguredBindMode,
} from "./network-bind.js";

describe("isLoopbackHost", () => {
  it.each(["127.0.0.1", "localhost", "::1", "LOCALHOST", "127.0.0.1"])(
    "returns true for %s",
    (host) => expect(isLoopbackHost(host)).toBe(true),
  );

  it.each(["0.0.0.0", "192.168.1.1", "example.com", "", null, undefined])(
    "returns false for %s",
    (host) => expect(isLoopbackHost(host)).toBe(false),
  );
});

describe("isAllInterfacesHost", () => {
  it.each(["0.0.0.0", "::"])(
    "returns true for %s",
    (host) => expect(isAllInterfacesHost(host)).toBe(true),
  );

  it.each(["127.0.0.1", "localhost", "192.168.1.1", null, undefined])(
    "returns false for %s",
    (host) => expect(isAllInterfacesHost(host)).toBe(false),
  );
});

describe("inferBindModeFromHost", () => {
  it("infers loopback for 127.0.0.1", () => {
    expect(inferBindModeFromHost("127.0.0.1")).toBe("loopback");
  });

  it("infers loopback for localhost", () => {
    expect(inferBindModeFromHost("localhost")).toBe("loopback");
  });

  it("infers loopback for undefined", () => {
    expect(inferBindModeFromHost(undefined)).toBe("loopback");
  });

  it("infers lan for 0.0.0.0", () => {
    expect(inferBindModeFromHost("0.0.0.0")).toBe("lan");
  });

  it("infers tailnet when host matches tailnetBindHost", () => {
    expect(inferBindModeFromHost("100.64.0.1", { tailnetBindHost: "100.64.0.1" })).toBe("tailnet");
  });

  it("infers custom for arbitrary non-loopback non-all-interfaces host", () => {
    expect(inferBindModeFromHost("192.168.1.42")).toBe("custom");
  });
});

describe("validateConfiguredBindMode", () => {
  it("returns no errors for authenticated/private/loopback", () => {
    const errors = validateConfiguredBindMode({
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bind: "loopback",
    });
    expect(errors).toHaveLength(0);
  });

  it("errors when local_trusted uses lan bind", () => {
    const errors = validateConfiguredBindMode({
      deploymentMode: "local_trusted",
      deploymentExposure: "private",
      bind: "lan",
    });
    expect(errors.some((e) => e.includes("loopback"))).toBe(true);
  });

  it("errors when custom bind has no customBindHost", () => {
    const errors = validateConfiguredBindMode({
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bind: "custom",
    });
    expect(errors.some((e) => e.includes("customBindHost"))).toBe(true);
  });

  it("no error when custom bind has customBindHost", () => {
    const errors = validateConfiguredBindMode({
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bind: "custom",
      customBindHost: "192.168.1.42",
    });
    expect(errors).toHaveLength(0);
  });

  it("errors when authenticated/public uses tailnet", () => {
    const errors = validateConfiguredBindMode({
      deploymentMode: "authenticated",
      deploymentExposure: "public",
      bind: "tailnet",
    });
    expect(errors.some((e) => e.includes("tailnet"))).toBe(true);
  });
});

describe("resolveRuntimeBind", () => {
  it("resolves loopback bind to 127.0.0.1", () => {
    const result = resolveRuntimeBind({ bind: "loopback" });
    expect(result.host).toBe("127.0.0.1");
    expect(result.bind).toBe("loopback");
    expect(result.errors).toHaveLength(0);
  });

  it("resolves lan bind to 0.0.0.0", () => {
    const result = resolveRuntimeBind({ bind: "lan" });
    expect(result.host).toBe("0.0.0.0");
    expect(result.bind).toBe("lan");
    expect(result.errors).toHaveLength(0);
  });

  it("resolves custom bind using customBindHost", () => {
    const result = resolveRuntimeBind({ bind: "custom", customBindHost: "10.0.0.5" });
    expect(result.host).toBe("10.0.0.5");
    expect(result.bind).toBe("custom");
    expect(result.errors).toHaveLength(0);
  });

  it("errors on custom bind without customBindHost", () => {
    const result = resolveRuntimeBind({ bind: "custom" });
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("resolves tailnet bind to tailnetBindHost", () => {
    const result = resolveRuntimeBind({ bind: "tailnet", tailnetBindHost: "100.64.0.1" });
    expect(result.host).toBe("100.64.0.1");
    expect(result.errors).toHaveLength(0);
  });

  it("errors on tailnet bind without tailnetBindHost", () => {
    const result = resolveRuntimeBind({ bind: "tailnet" });
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("infers bind from legacy host=0.0.0.0", () => {
    const result = resolveRuntimeBind({ host: "0.0.0.0" });
    expect(result.bind).toBe("lan");
    expect(result.host).toBe("0.0.0.0");
  });
});
