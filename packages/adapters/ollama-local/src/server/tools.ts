/**
 * Paperclip tool definitions and execution for the Ollama adapter.
 *
 * Ollama models that support function-calling (llama3.1, qwen2.5, mistral, etc.)
 * receive these tools at run-start. The adapter executes each tool call against
 * the Paperclip API and feeds the results back to the model — giving ollama agents
 * the same ability to act on Paperclip that Claude Code agents have via bash.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OllamaToolFunction {
  name: string;
  description: string;
  parameters: {
    type: "object";
    required?: string[];
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
  };
}

export interface OllamaTool {
  type: "function";
  function: OllamaToolFunction;
}

export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface PaperclipApiContext {
  apiUrl: string;
  companyId: string;
  agentId: string;
  authToken?: string;
}

// ---------------------------------------------------------------------------
// Tool schema — matches what Ollama expects in the `tools` request field
// ---------------------------------------------------------------------------

export const PAPERCLIP_TOOLS: OllamaTool[] = [
  {
    type: "function",
    function: {
      name: "paperclip_get_issue",
      description:
        "Fetch the full details of a Paperclip issue, including its description, status, priority, and recent comments.",
      parameters: {
        type: "object",
        required: ["issueId"],
        properties: {
          issueId: { type: "string", description: "The issue ID (e.g. 'issue_abc123')" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclip_list_issues",
      description: "List open issues in this company. Use to understand what work exists.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum number of issues to return (default: 20)" },
          status: {
            type: "string",
            description: "Filter by status",
            enum: ["todo", "in_progress", "in_review", "done", "blocked", "cancelled"],
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclip_create_issue",
      description:
        "Create a new issue in Paperclip. Use this to kick off work, create sub-tasks, or track decisions.",
      parameters: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", description: "Short, clear issue title" },
          description: { type: "string", description: "Full issue description (markdown supported)" },
          priority: {
            type: "string",
            enum: ["urgent", "high", "medium", "low"],
            description: "Issue priority (default: medium)",
          },
          assigneeAgentId: {
            type: "string",
            description: "Agent ID to assign the issue to (leave blank to leave unassigned)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclip_update_issue",
      description:
        "Update an existing issue's status, title, or description. Use to mark work done, block, or reassign.",
      parameters: {
        type: "object",
        required: ["issueId"],
        properties: {
          issueId: { type: "string", description: "The issue ID to update" },
          status: {
            type: "string",
            enum: ["todo", "in_progress", "in_review", "done", "blocked", "cancelled"],
            description: "New status",
          },
          title: { type: "string", description: "Updated title" },
          description: { type: "string", description: "Updated description" },
          assigneeAgentId: { type: "string", description: "Agent ID to reassign to" },
          priority: {
            type: "string",
            enum: ["urgent", "high", "medium", "low"],
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclip_post_comment",
      description:
        "Post a comment on an issue. Use to report progress, decisions, or findings directly on the issue thread.",
      parameters: {
        type: "object",
        required: ["issueId", "body"],
        properties: {
          issueId: { type: "string", description: "The issue ID to comment on" },
          body: { type: "string", description: "Comment text (markdown supported)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclip_list_agents",
      description:
        "List all AI agents in this company — their names, roles, and adapter types. Use to understand who is already staffed.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclip_create_agent",
      description:
        "Hire a new AI agent for the company. Creates the agent with instructions and an adapter. " +
        "Use this when you need to staff a new role: engineer, designer, QA, researcher, etc. " +
        "After creation, assign the agent to issues to give it work.",
      parameters: {
        type: "object",
        required: ["name", "role"],
        properties: {
          name: {
            type: "string",
            description: "Agent display name, e.g. 'Backend Engineer' or 'QA Lead'",
          },
          role: {
            type: "string",
            enum: ["engineer", "designer", "pm", "qa", "devops", "researcher", "general"],
            description: "The agent's organisational role",
          },
          adapterType: {
            type: "string",
            enum: ["ollama_local", "claude_local", "codex_local", "gemini_local"],
            description: "The AI model adapter (default: ollama_local)",
          },
          model: {
            type: "string",
            description: "Model name for the adapter, e.g. 'gemma4:26b' or 'llama3.2'",
          },
          instructions: {
            type: "string",
            description:
              "System instructions for the agent — what it does, its expertise, how it should work",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclip_list_goals",
      description: "List company goals. Use to understand strategic objectives and whether work is aligned.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum number of goals to return (default: 20)" },
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool execution — calls the Paperclip REST API
// ---------------------------------------------------------------------------

function buildHeaders(authToken?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  return headers;
}

async function paperclipFetch(
  url: string,
  options: RequestInit & { authToken?: string },
): Promise<unknown> {
  const { authToken, ...rest } = options;
  const headers = buildHeaders(authToken);
  try {
    const res = await fetch(url, { ...rest, headers: { ...headers, ...(rest.headers ?? {}) } });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return { error: `HTTP ${res.status} ${res.statusText}`, detail: text.slice(0, 400) };
    }
    try {
      return JSON.parse(text);
    } catch {
      return { result: text.slice(0, 2000) };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function executePaperclipTool(
  call: OllamaToolCall,
  ctx: PaperclipApiContext,
): Promise<unknown> {
  const { apiUrl, companyId, agentId, authToken } = ctx;
  const base = apiUrl.replace(/\/$/, "");
  const args = call.function.arguments ?? {};
  const name = call.function.name;

  switch (name) {
    case "paperclip_get_issue": {
      const id = String(args.issueId ?? "");
      if (!id) return { error: "issueId is required" };
      return paperclipFetch(`${base}/api/issues/${encodeURIComponent(id)}`, {
        method: "GET",
        authToken,
      });
    }

    case "paperclip_list_issues": {
      const limit = typeof args.limit === "number" ? args.limit : 20;
      const status = typeof args.status === "string" ? args.status : null;
      const qs = new URLSearchParams({ limit: String(limit) });
      if (status) qs.set("status", status);
      return paperclipFetch(`${base}/api/companies/${encodeURIComponent(companyId)}/issues?${qs}`, {
        method: "GET",
        authToken,
      });
    }

    case "paperclip_create_issue": {
      const body: Record<string, unknown> = {
        title: String(args.title ?? ""),
        description: typeof args.description === "string" ? args.description : undefined,
        priority: typeof args.priority === "string" ? args.priority : "medium",
      };
      if (typeof args.assigneeAgentId === "string" && args.assigneeAgentId.trim()) {
        body.assigneeAgentId = args.assigneeAgentId.trim();
      }
      return paperclipFetch(`${base}/api/companies/${encodeURIComponent(companyId)}/issues`, {
        method: "POST",
        body: JSON.stringify(body),
        authToken,
      });
    }

    case "paperclip_update_issue": {
      const id = String(args.issueId ?? "");
      if (!id) return { error: "issueId is required" };
      const updates: Record<string, unknown> = {};
      if (typeof args.status === "string") updates.status = args.status;
      if (typeof args.title === "string") updates.title = args.title;
      if (typeof args.description === "string") updates.description = args.description;
      if (typeof args.assigneeAgentId === "string") updates.assigneeAgentId = args.assigneeAgentId;
      if (typeof args.priority === "string") updates.priority = args.priority;
      return paperclipFetch(`${base}/api/issues/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
        authToken,
      });
    }

    case "paperclip_post_comment": {
      const id = String(args.issueId ?? "");
      if (!id) return { error: "issueId is required" };
      const body = typeof args.body === "string" ? args.body : "";
      if (!body.trim()) return { error: "comment body cannot be empty" };
      return paperclipFetch(`${base}/api/issues/${encodeURIComponent(id)}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
        authToken,
      });
    }

    case "paperclip_list_agents": {
      return paperclipFetch(`${base}/api/companies/${encodeURIComponent(companyId)}/agents`, {
        method: "GET",
        authToken,
      });
    }

    case "paperclip_create_agent": {
      const adapterType = typeof args.adapterType === "string" ? args.adapterType : "ollama_local";
      const model = typeof args.model === "string" && args.model.trim() ? args.model.trim() : undefined;
      const config: Record<string, unknown> = {};
      if (model) config.model = model;
      if (typeof args.instructions === "string" && args.instructions.trim()) {
        config.system = args.instructions.trim();
      }
      // Disable raw skill injection for new agents by default so they start lean
      config.paperclipRuntimeSkills = [];

      const body: Record<string, unknown> = {
        name: String(args.name ?? "New Agent"),
        role: typeof args.role === "string" ? args.role : "general",
        adapterType,
        adapterConfig: config,
      };
      // Use /agent-hires — the agent-safe endpoint that respects canCreateAgents permission
      const result = await paperclipFetch(
        `${base}/api/companies/${encodeURIComponent(companyId)}/agent-hires`,
        { method: "POST", body: JSON.stringify(body), authToken },
      );
      return result;
    }

    case "paperclip_list_goals": {
      const limit = typeof args.limit === "number" ? args.limit : 20;
      return paperclipFetch(
        `${base}/api/companies/${encodeURIComponent(companyId)}/goals?limit=${limit}`,
        { method: "GET", authToken },
      );
    }

    default:
      return { error: `Unknown Paperclip tool: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the API context from the execution environment.
 * Falls back to process.env for the API URL (server-side, always set).
 */
export function buildPaperclipApiContext(
  agent: { id: string; companyId: string },
  authToken?: string,
): PaperclipApiContext {
  const runtimeHost = resolveHostForUrl(
    process.env.PAPERCLIP_LISTEN_HOST ?? process.env.HOST ?? "localhost",
  );
  const runtimePort = process.env.PAPERCLIP_LISTEN_PORT ?? process.env.PORT ?? "3100";
  const apiUrl = process.env.PAPERCLIP_API_URL ?? `http://${runtimeHost}:${runtimePort}`;
  return {
    apiUrl,
    companyId: agent.companyId,
    agentId: agent.id,
    authToken,
  };
}

function resolveHostForUrl(rawHost: string): string {
  const host = rawHost.trim();
  if (!host || host === "0.0.0.0" || host === "::") return "localhost";
  if (host.includes(":") && !host.startsWith("[") && !host.endsWith("]")) return `[${host}]`;
  return host;
}
