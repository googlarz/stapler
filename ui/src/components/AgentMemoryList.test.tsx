// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMemory } from "@paperclipai/shared";
import { AgentMemoryList } from "./AgentMemoryList";

const mockAgentMemoriesApi = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../api/agentMemories", () => ({
  agentMemoriesApi: mockAgentMemoriesApi,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function buildMemory(overrides: Partial<AgentMemory> = {}): AgentMemory {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    companyId: "company-1",
    agentId: "agent-1",
    content: "user prefers French over English",
    contentHash: "a".repeat(64),
    contentBytes: 30,
    tags: ["preference", "language"],
    scope: "agent",
    createdInRunId: null,
    createdAt: new Date("2026-04-10T00:00:00.000Z"),
    updatedAt: new Date("2026-04-10T00:00:00.000Z"),
    ...overrides,
  };
}

function renderList(container: HTMLDivElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(container);
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AgentMemoryList agentId="agent-1" />
      </QueryClientProvider>,
    );
  });
  return root;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitForText(
  container: Element,
  predicate: (text: string) => boolean,
  timeoutMs = 1500,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (container.textContent && predicate(container.textContent)) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  throw new Error(
    `waitForText timed out. Current text:\n${container.textContent?.slice(0, 500)}`,
  );
}

describe("AgentMemoryList", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockAgentMemoriesApi.list.mockReset();
    mockAgentMemoriesApi.remove.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders memories after the list query resolves", async () => {
    mockAgentMemoriesApi.list.mockResolvedValue({
      items: [buildMemory()],
      mode: "list",
    });

    const root = renderList(container);
    await waitForText(container, (t) => t.includes("user prefers French over English"));

    expect(container.textContent).toContain("preference");
    expect(container.textContent).toContain("language");
    // The list mode should NOT show a similarity score.
    expect(container.textContent).not.toContain("score 0.");

    await act(async () => {
      root.unmount();
    });
  });

  it("shows the empty state when the agent has no memories", async () => {
    mockAgentMemoriesApi.list.mockResolvedValue({
      items: [],
      mode: "list",
    });

    const root = renderList(container);
    await waitForText(container, (t) => t.includes("No memories saved yet"));

    await act(async () => {
      root.unmount();
    });
  });

  it("surfaces similarity scores when the response is in search mode", async () => {
    mockAgentMemoriesApi.list.mockResolvedValue({
      items: [{ ...buildMemory(), score: 0.42 }],
      mode: "search",
    });

    const root = renderList(container);
    await waitForText(container, (t) => t.includes("score 0.42"));

    await act(async () => {
      root.unmount();
    });
  });

  it("renders a friendly error message when the query fails", async () => {
    mockAgentMemoriesApi.list.mockRejectedValue(new Error("boom"));

    const root = renderList(container);
    await waitForText(container, (t) => t.includes("Couldn't load memories"));
    expect(container.textContent).toContain("boom");

    await act(async () => {
      root.unmount();
    });
  });
});
