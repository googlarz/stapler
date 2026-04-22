import { describe, it, expect } from "vitest";
import { checkPort } from "./net.js";

// checkPort makes real network calls (creates a TCP server to probe port availability).
// These are integration-level tests that exercise the actual node:net behavior.

describe("checkPort", () => {
  it("returns { available: true } for a free port", async () => {
    // Port 0 asks the OS to assign any free ephemeral port — always available
    const result = await checkPort(0);
    expect(result).toEqual({ available: true });
  });

  it("returns { available: false, error: string } for an in-use port", async () => {
    // Start a server on an ephemeral port then check the same port
    const net = await import("node:net");
    const server = net.default.createServer();

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const port = address.port;

    try {
      const result = await checkPort(port);
      expect(result.available).toBe(false);
      expect(typeof result.error).toBe("string");
      expect(result.error).toContain(String(port));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("resolves (does not reject) even for in-use ports", async () => {
    // Port 1 is typically reserved/in-use on most systems; if not, we use the busy-port approach above
    await expect(checkPort(1)).resolves.toMatchObject({ available: expect.any(Boolean) });
  });

  it("returns a Promise", () => {
    const result = checkPort(0);
    expect(result).toBeInstanceOf(Promise);
    return result; // ensure it resolves cleanly
  });
});
