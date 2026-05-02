import net from "node:net";
import os from "node:os";

function getNonLoopbackAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const entry of iface) {
      if (!entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

function probeAddress(address: string, port: number, timeoutMs: number): Promise<"reachable" | "refused" | "timeout"> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const settle = (result: "reachable" | "refused" | "timeout") => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => settle("timeout"), timeoutMs);
    socket.unref();

    socket.on("connect", () => {
      clearTimeout(timer);
      settle("reachable");
    });

    socket.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      settle(err.code === "ECONNREFUSED" ? "refused" : "timeout");
    });

    socket.connect(port, address);
  });
}

/**
 * Asserts that the embedded PostgreSQL instance is not reachable on any
 * non-loopback network interface. This is a defence-in-depth check that
 * verifies the listen_addresses=127.0.0.1 flag actually took effect before
 * the server starts accepting production traffic.
 *
 * Throws if any non-loopback address accepts a TCP connection on `port`.
 */
export async function assertPgNotReachableOnInterfaces(port: number, timeoutMs = 500): Promise<void> {
  const addresses = getNonLoopbackAddresses();
  if (addresses.length === 0) return;

  const results = await Promise.all(
    addresses.map(async (address) => ({ address, result: await probeAddress(address, port, timeoutMs) })),
  );

  const reachable = results.filter((r) => r.result === "reachable");
  if (reachable.length > 0) {
    const list = reachable.map((r) => r.address).join(", ");
    throw new Error(
      `Embedded PostgreSQL is reachable on non-loopback interface(s): ${list}. ` +
        "This is a security violation — the database must only listen on 127.0.0.1. " +
        "Check that listen_addresses=127.0.0.1 is being passed via postgresFlags.",
    );
  }
}
