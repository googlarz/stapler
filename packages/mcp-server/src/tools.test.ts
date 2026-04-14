import { beforeEach, describe, expect, it, vi } from "vitest";
import { StaplerApiClient } from "./client.js";
import { createToolDefinitions } from "./tools.js";

function makeClient() {
  return new StaplerApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-123",
    companyId: "11111111-1111-1111-1111-111111111111",
    agentId: "22222222-2222-2222-2222-222222222222",
    runId: "33333333-3333-3333-3333-333333333333",
  });
}

function getTool(name: string) {
  const tool = createToolDefinitions(makeClient()).find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

function mockJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("paperclip MCP tools", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("adds auth headers and run id to mutating requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("updateIssue");
    await tool.execute({
      issueId: "PAP-1135",
      status: "done",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("http://localhost:3100/api/issues/PAP-1135");
    expect(init.method).toBe("PATCH");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer token-123");
    expect((init.headers as Record<string, string>)["X-Paperclip-Run-Id"]).toBe(
      "33333333-3333-3333-3333-333333333333",
    );
  });

  it("uses default company id for company-scoped list tools", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse([{ id: "issue-1" }]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("listIssues");
    const response = await tool.execute({});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(String(url)).toBe(
      "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/issues",
    );
    expect(response.content[0]?.text).toContain("issue-1");
  });

  it("uses default agent id for checkout requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ id: "PAP-1135", status: "in_progress" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("checkoutIssue");
    await tool.execute({
      issueId: "PAP-1135",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      agentId: "22222222-2222-2222-2222-222222222222",
      expectedStatuses: ["todo", "backlog", "blocked"],
    });
  });

  it("defaults issue document format to markdown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ key: "plan", latestRevisionNumber: 2 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("upsertIssueDocument");
    await tool.execute({
      issueId: "PAP-1135",
      key: "plan",
      body: "# Updated",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      format: "markdown",
      body: "# Updated",
    });
  });

  it("creates approvals with the expected company-scoped payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ id: "approval-1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("createApproval");
    await tool.execute({
      type: "hire_agent",
      payload: { branch: "pap-1167" },
      issueIds: ["44444444-4444-4444-4444-444444444444"],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(
      "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/approvals",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      type: "hire_agent",
      payload: { branch: "pap-1167" },
      issueIds: ["44444444-4444-4444-4444-444444444444"],
    });
  });

  it("rejects invalid generic request paths", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const tool = getTool("apiRequest");
    const response = await tool.execute({
      method: "GET",
      path: "issues",
    });

    expect(response.content[0]?.text).toContain("path must start with /");
  });

  it("rejects generic request paths that escape /api", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const tool = getTool("apiRequest");
    const response = await tool.execute({
      method: "GET",
      path: "/../../secret",
    });

    expect(response.content[0]?.text).toContain("must not contain '..'");
  });

  it("rejects percent-encoded path traversal attempts", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const tool = getTool("apiRequest");
    const response = await tool.execute({
      method: "GET",
      path: "/%2e%2e/secret",
    });

    expect(response.content[0]?.text).toContain("must not contain '..'");
  });

  describe("agent memory tools", () => {
    it("memorySave POSTs to the resolved agent's memories endpoint with run id", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockJsonResponse({
          memory: { id: "mem-1", content: "note" },
          deduped: false,
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const tool = getTool("memorySave");
      await tool.execute({
        content: "user prefers French",
        tags: ["preference", "language"],
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(String(url)).toBe(
        "http://localhost:3100/api/agents/22222222-2222-2222-2222-222222222222/memories",
      );
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer token-123");
      expect((init.headers as Record<string, string>)["X-Paperclip-Run-Id"]).toBe(
        "33333333-3333-3333-3333-333333333333",
      );
      expect(JSON.parse(String(init.body))).toEqual({
        content: "user prefers French",
        tags: ["preference", "language"],
      });
    });

    it("memorySearch builds the query string with q, limit, and tags", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockJsonResponse({ items: [], mode: "search" }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const tool = getTool("memorySearch");
      await tool.execute({ q: "french", limit: 5, tags: ["preference"] });

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe(
        "/api/agents/22222222-2222-2222-2222-222222222222/memories",
      );
      expect(parsed.searchParams.get("q")).toBe("french");
      expect(parsed.searchParams.get("limit")).toBe("5");
      expect(parsed.searchParams.get("tags")).toBe("preference");
    });

    it("memoryList omits query params when none are passed", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockJsonResponse({ items: [], mode: "list" }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const tool = getTool("memoryList");
      await tool.execute({});

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(String(url)).toBe(
        "http://localhost:3100/api/agents/22222222-2222-2222-2222-222222222222/memories",
      );
      expect(init.method).toBe("GET");
    });

    it("memoryList includes tags when provided", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockJsonResponse({ items: [], mode: "list" }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const tool = getTool("memoryList");
      await tool.execute({ limit: 20, tags: ["a", "b"] });

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      const parsed = new URL(String(url));
      expect(parsed.searchParams.get("limit")).toBe("20");
      expect(parsed.searchParams.get("tags")).toBe("a,b");
    });

    it("memoryDelete issues DELETE with the memory id and run id header", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockJsonResponse({ id: "mem-1" }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const tool = getTool("memoryDelete");
      await tool.execute({ id: "99999999-9999-9999-9999-999999999999" });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(String(url)).toBe(
        "http://localhost:3100/api/agents/22222222-2222-2222-2222-222222222222/memories/99999999-9999-9999-9999-999999999999",
      );
      expect(init.method).toBe("DELETE");
      expect((init.headers as Record<string, string>)["X-Paperclip-Run-Id"]).toBe(
        "33333333-3333-3333-3333-333333333333",
      );
    });

    it("memory tools throw a useful error when STAPLER_AGENT_ID is not set", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const clientWithoutAgent = new StaplerApiClient({
        apiUrl: "http://localhost:3100/api",
        apiKey: "token-123",
        companyId: "11111111-1111-1111-1111-111111111111",
        agentId: null,
        runId: "33333333-3333-3333-3333-333333333333",
      });
      const tool = createToolDefinitions(clientWithoutAgent).find(
        (t) => t.name === "memorySave",
      );
      if (!tool) throw new Error("missing tool");

      const response = await tool.execute({ content: "anything" });
      expect(response.content[0]?.text).toContain("STAPLER_AGENT_ID");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
