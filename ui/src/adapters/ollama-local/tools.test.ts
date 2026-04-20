import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeStaplerTool } from "@stapler/adapter-ollama-local/server";

const CTX = {
  apiUrl: "http://localhost:4000",
  companyId: "company-1",
  agentId: "agent-1",
  authToken: "tok-test",
};

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

describe("executeStaplerTool — stapler_save_memory", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch(200, { id: "mem-1", content: "saved" }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("saves memory with array tags", async () => {
    const result = await executeStaplerTool(
      { function: { name: "stapler_save_memory", arguments: { content: "hello", tags: ["a", "b"] } } },
      CTX,
    );
    expect(result).toMatchObject({ id: "mem-1" });
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/memories");
    const sent = JSON.parse(opts.body as string);
    expect(sent.tags).toEqual(["a", "b"]);
  });

  it("accepts legacy comma-string tags and splits them", async () => {
    await executeStaplerTool(
      { function: { name: "stapler_save_memory", arguments: { content: "hi", tags: "x,y" } } },
      CTX,
    );
    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(opts.body as string);
    expect(sent.tags).toEqual(["x", "y"]);
  });

  it("forwards expiresAt when provided", async () => {
    await executeStaplerTool(
      {
        function: {
          name: "stapler_save_memory",
          arguments: { content: "tmp", expiresAt: "2099-01-01T00:00:00Z" },
        },
      },
      CTX,
    );
    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(opts.body as string);
    expect(sent.expiresAt).toBe("2099-01-01T00:00:00Z");
  });

  it("returns error when content is missing", async () => {
    const result = (await executeStaplerTool(
      { function: { name: "stapler_save_memory", arguments: {} } },
      CTX,
    )) as { error: string };
    expect(result.error).toMatch(/content/i);
  });
});

describe("executeStaplerTool — stapler_delete_memory", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch(200, { deleted: true }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("calls DELETE on the correct memory URL", async () => {
    await executeStaplerTool(
      { function: { name: "stapler_delete_memory", arguments: { memoryId: "mem-42" } } },
      CTX,
    );
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/memories/mem-42");
    expect(opts.method).toBe("DELETE");
  });

  it("returns error when memoryId is missing", async () => {
    const result = (await executeStaplerTool(
      { function: { name: "stapler_delete_memory", arguments: {} } },
      CTX,
    )) as { error: string };
    expect(result.error).toMatch(/memoryId/i);
  });
});

describe("executeStaplerTool — stapler_create_goal", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch(201, { id: "goal-1", title: "Ship it" }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("creates a goal with title", async () => {
    const result = await executeStaplerTool(
      { function: { name: "stapler_create_goal", arguments: { title: "Ship it" } } },
      CTX,
    );
    expect(result).toMatchObject({ id: "goal-1" });
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/goals");
    const sent = JSON.parse(opts.body as string);
    expect(sent.title).toBe("Ship it");
  });

  it("returns error when title is missing", async () => {
    const result = (await executeStaplerTool(
      { function: { name: "stapler_create_goal", arguments: {} } },
      CTX,
    )) as { error: string };
    expect(result.error).toMatch(/title/i);
  });
});

describe("executeStaplerTool — stapler_update_goal", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch(200, { id: "goal-1", status: "completed" }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends PATCH with the provided fields", async () => {
    await executeStaplerTool(
      {
        function: {
          name: "stapler_update_goal",
          arguments: { goalId: "goal-1", status: "completed" },
        },
      },
      CTX,
    );
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/goals/goal-1");
    expect(opts.method).toBe("PATCH");
  });

  it("returns error when goalId is missing", async () => {
    const result = (await executeStaplerTool(
      { function: { name: "stapler_update_goal", arguments: { status: "completed" } } },
      CTX,
    )) as { error: string };
    expect(result.error).toMatch(/goalId/i);
  });
});
