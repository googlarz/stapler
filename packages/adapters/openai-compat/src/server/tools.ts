/**
 * Stapler tool definitions and execution for the OpenAI-compatible adapter.
 *
 * Tool schema is identical to the Ollama adapter (both use the OpenAI
 * function-calling format). The key difference is that the OpenAI API returns
 * `function.arguments` as a **JSON string**, not a parsed object.
 * `executeStaplerTool` normalises this before dispatching.
 *
 * Tool definitions are intentionally kept in sync with
 * packages/adapters/ollama-local/src/server/tools.ts — update both when
 * adding or removing tools.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenAiToolFunction {
  name: string;
  description: string;
  parameters: {
    type: "object";
    required?: string[];
    properties: Record<string, { type: string; description?: string; enum?: string[]; items?: { type: string } }>;
  };
}

export interface OpenAiTool {
  type: "function";
  function: OpenAiToolFunction;
}

/** OpenAI tool call returned in non-streaming responses. */
export interface OpenAiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON-encoded string — parsed before dispatching to executeStaplerTool. */
    arguments: string | Record<string, unknown>;
  };
}

export interface StaplerApiContext {
  apiUrl: string;
  companyId: string;
  agentId: string;
  authToken?: string;
}

// ---------------------------------------------------------------------------
// Tool schema — OpenAI function-calling format
// ---------------------------------------------------------------------------

export const STAPLER_TOOLS: OpenAiTool[] = [
  {
    type: "function",
    function: {
      name: "stapler_get_issue",
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
      name: "stapler_list_issues",
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
      name: "stapler_create_issue",
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
            enum: ["critical", "high", "medium", "low"],
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
      name: "stapler_update_issue",
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
            enum: ["critical", "high", "medium", "low"],
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_post_comment",
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
      name: "stapler_list_agents",
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
      name: "stapler_get_agent",
      description:
        "Fetch details about a specific agent — their name, role, status, current config, and assigned issues.",
      parameters: {
        type: "object",
        required: ["agentId"],
        properties: {
          agentId: { type: "string", description: "The agent ID (UUID)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_create_agent",
      description:
        "Hire a new AI agent for the company. Creates the agent with instructions and an adapter.",
      parameters: {
        type: "object",
        required: ["name", "role"],
        properties: {
          name: { type: "string", description: "Agent display name" },
          role: {
            type: "string",
            enum: ["engineer", "designer", "pm", "qa", "devops", "researcher", "general"],
            description: "The agent's organisational role",
          },
          adapterType: {
            type: "string",
            enum: ["openai_compat", "ollama_local", "claude_local", "codex_local", "gemini_local"],
            description: "The AI model adapter (default: openai_compat)",
          },
          model: { type: "string", description: "Model name for the adapter" },
          instructions: {
            type: "string",
            description: "System instructions for the agent",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_wake_agent",
      description:
        "Wake an agent and give it a task to work on. The agent will run immediately with the given reason.",
      parameters: {
        type: "object",
        required: ["agentId", "reason"],
        properties: {
          agentId: { type: "string", description: "The agent ID (UUID) to wake" },
          reason: { type: "string", description: "Brief description of the task or reason for waking the agent" },
          issueId: { type: "string", description: "The issue ID to focus on (optional but recommended)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_save_memory",
      description:
        "Save a memory for yourself. Use to record decisions, learnings, context, or facts you want to remember in future runs.",
      parameters: {
        type: "object",
        required: ["content"],
        properties: {
          content: { type: "string", description: "The memory content to save" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags to categorise the memory",
          },
          expiresAt: { type: "string", description: "ISO 8601 expiry datetime" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_search_memories",
      description: "Search your memories for relevant context.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Maximum memories to return (default: 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_delete_memory",
      description: "Delete one of your own memories by ID.",
      parameters: {
        type: "object",
        required: ["memoryId"],
        properties: {
          memoryId: { type: "string", description: "The memory ID to delete" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_list_goals",
      description: "List company goals. Use to understand strategic objectives.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum number of goals to return (default: 20)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_create_goal",
      description: "Create a new company goal with a title, description, and acceptance criteria.",
      parameters: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", description: "Short, clear goal title" },
          description: { type: "string", description: "Goal description (markdown supported)" },
          acceptanceCriteria: { type: "string", description: "Definition of done" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_update_goal",
      description: "Update an existing goal's status, description, or acceptance criteria.",
      parameters: {
        type: "object",
        required: ["goalId"],
        properties: {
          goalId: { type: "string", description: "The goal ID to update" },
          status: {
            type: "string",
            enum: ["open", "in_progress", "achieved", "abandoned"],
          },
          title: { type: "string" },
          description: { type: "string" },
          acceptanceCriteria: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_list_company_memories",
      description: "List all shared company memories.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum number of memories to return (1–200). Defaults to 50." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_list_outputs",
      description: "List all company outputs — living documents agents collaboratively produce.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_get_output",
      description: "Get a company output by ID, including draft content and version history.",
      parameters: {
        type: "object",
        properties: { outputId: { type: "string" } },
        required: ["outputId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_propose_output",
      description: "Propose a new company output that needs CEO approval.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_update_output_draft",
      description: "Overwrite the current working draft of an output.",
      parameters: {
        type: "object",
        properties: {
          outputId: { type: "string" },
          content: { type: "string", description: "Full new draft content (markdown supported)." },
        },
        required: ["outputId", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_release_output_version",
      description: "Snapshot the current draft as a new immutable version.",
      parameters: {
        type: "object",
        properties: {
          outputId: { type: "string" },
          releaseNotes: { type: "string" },
        },
        required: ["outputId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_decompose_goal",
      description: "Decompose a goal into concrete implementation issues.",
      parameters: {
        type: "object",
        properties: {
          goalId: { type: "string" },
          assigneeAgentId: { type: "string" },
          maxIssues: { type: "number" },
        },
        required: ["goalId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_delegate_task",
      description:
        "Delegate a task to another agent. Creates an issue, assigns it, wakes the agent. Returns a delegationId.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "ID of the target agent to delegate to." },
          task: { type: "string", description: "Task description." },
          context: { type: "string", description: "Additional background or constraints." },
        },
        required: ["agentId", "task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_check_delegation",
      description: "Check the status of a previously delegated task. Poll until status is 'done' or 'failed'.",
      parameters: {
        type: "object",
        properties: {
          delegationId: { type: "string", description: "The issue ID returned by stapler_delegate_task." },
        },
        required: ["delegationId"],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool execution
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

/**
 * Execute a Stapler tool call dispatched by an OpenAI-compatible model.
 *
 * OpenAI returns `function.arguments` as a JSON **string**; Ollama returns
 * it as a parsed object. This function normalises both before dispatching.
 */
export async function executeStaplerTool(
  call: OpenAiToolCall,
  ctx: StaplerApiContext,
): Promise<unknown> {
  const { apiUrl, companyId, agentId, authToken } = ctx;
  const base = apiUrl.replace(/\/$/, "");

  // Normalise arguments: OpenAI returns a JSON string, but some proxies
  // (e.g. vLLM, LiteLLM older versions) may return an already-parsed object.
  let args: Record<string, unknown>;
  try {
    args = typeof call.function.arguments === "string"
      ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
      : (call.function.arguments as Record<string, unknown>) ?? {};
  } catch {
    args = {};
  }

  // Backward-compat alias: pre-rename agents call paperclip_* tools
  const name = call.function.name.startsWith("paperclip_")
    ? "stapler_" + call.function.name.slice("paperclip_".length)
    : call.function.name;

  switch (name) {
    case "stapler_get_issue": {
      const id = String(args.issueId ?? "");
      if (!id) return { error: "issueId is required" };
      return paperclipFetch(`${base}/api/issues/${encodeURIComponent(id)}`, { method: "GET", authToken });
    }

    case "stapler_list_issues": {
      const limit = typeof args.limit === "number" ? args.limit : 20;
      const status = typeof args.status === "string" ? args.status : null;
      const qs = new URLSearchParams({ limit: String(limit) });
      if (status) qs.set("status", status);
      return paperclipFetch(`${base}/api/companies/${encodeURIComponent(companyId)}/issues?${qs}`, { method: "GET", authToken });
    }

    case "stapler_create_issue": {
      const body: Record<string, unknown> = {
        title: String(args.title ?? ""),
        description: typeof args.description === "string" ? args.description : undefined,
        priority: typeof args.priority === "string" ? args.priority : "medium",
      };
      if (typeof args.assigneeAgentId === "string" && args.assigneeAgentId.trim()) {
        body.assigneeAgentId = args.assigneeAgentId.trim();
      }
      return paperclipFetch(`${base}/api/companies/${encodeURIComponent(companyId)}/issues`, { method: "POST", body: JSON.stringify(body), authToken });
    }

    case "stapler_update_issue": {
      const id = String(args.issueId ?? "");
      if (!id) return { error: "issueId is required" };
      const updates: Record<string, unknown> = {};
      if (typeof args.status === "string") updates.status = args.status;
      if (typeof args.title === "string") updates.title = args.title;
      if (typeof args.description === "string") updates.description = args.description;
      if (typeof args.assigneeAgentId === "string") updates.assigneeAgentId = args.assigneeAgentId;
      if (typeof args.priority === "string") updates.priority = args.priority;
      return paperclipFetch(`${base}/api/issues/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(updates), authToken });
    }

    case "stapler_post_comment": {
      const id = String(args.issueId ?? "");
      if (!id) return { error: "issueId is required" };
      const body = typeof args.body === "string" ? args.body : "";
      if (!body.trim()) return { error: "comment body cannot be empty" };
      return paperclipFetch(`${base}/api/issues/${encodeURIComponent(id)}/comments`, { method: "POST", body: JSON.stringify({ body }), authToken });
    }

    case "stapler_list_agents":
      return paperclipFetch(`${base}/api/companies/${encodeURIComponent(companyId)}/agents`, { method: "GET", authToken });

    case "stapler_get_agent": {
      const rawId = String(args.agentId ?? "").trim();
      const id = rawId === "me" || rawId === "self" ? agentId : rawId;
      if (!id) return { error: "agentId is required" };
      return paperclipFetch(`${base}/api/agents/${encodeURIComponent(id)}`, { method: "GET", authToken });
    }

    case "stapler_create_agent": {
      const adapterType = typeof args.adapterType === "string" ? args.adapterType : "openai_compat";
      const model = typeof args.model === "string" && args.model.trim() ? args.model.trim() : undefined;
      const config: Record<string, unknown> = {};
      if (model) config.model = model;
      if (typeof args.instructions === "string" && args.instructions.trim()) {
        config.system = args.instructions.trim();
      }
      config.paperclipRuntimeSkills = [];
      const agentName = String(args.name ?? "").trim();
      if (!agentName) return { error: "name is required" };
      const body: Record<string, unknown> = {
        name: agentName,
        role: typeof args.role === "string" ? args.role : "general",
        adapterType,
        adapterConfig: config,
        runtimeConfig: { heartbeat: { enabled: true, intervalSec: 300 } },
      };
      return paperclipFetch(`${base}/api/companies/${encodeURIComponent(companyId)}/agent-hires`, { method: "POST", body: JSON.stringify(body), authToken });
    }

    case "stapler_wake_agent": {
      const id = String(args.agentId ?? "");
      if (!id) return { error: "agentId is required" };
      const reason = typeof args.reason === "string" ? args.reason.trim() : "";
      if (!reason) return { error: "reason is required" };
      const wakeBody: Record<string, unknown> = { source: "on_demand", reason };
      if (typeof args.issueId === "string" && args.issueId.trim()) {
        wakeBody.payload = { issueId: args.issueId.trim() };
      }
      return paperclipFetch(`${base}/api/agents/${encodeURIComponent(id)}/wakeup`, { method: "POST", body: JSON.stringify(wakeBody), authToken });
    }

    case "stapler_save_memory": {
      const content = typeof args.content === "string" ? args.content.trim() : "";
      if (!content) return { error: "content is required" };
      const tags: string[] = Array.isArray(args.tags)
        ? (args.tags as unknown[]).map(String).map((t) => t.trim()).filter(Boolean)
        : typeof args.tags === "string" && args.tags.trim()
          ? args.tags.split(",").map((t) => t.trim()).filter(Boolean)
          : [];
      const memBody: Record<string, unknown> = { content, tags };
      if (typeof args.expiresAt === "string" && args.expiresAt.trim()) {
        memBody.expiresAt = args.expiresAt.trim();
      }
      return paperclipFetch(`${base}/api/agents/${encodeURIComponent(agentId)}/memories`, { method: "POST", body: JSON.stringify(memBody), authToken });
    }

    case "stapler_search_memories": {
      const q = typeof args.query === "string" ? args.query.trim() : "";
      if (!q) return { error: "query is required" };
      const limit = typeof args.limit === "number" ? args.limit : 10;
      const qs = new URLSearchParams({ q, limit: String(limit) });
      return paperclipFetch(`${base}/api/agents/${encodeURIComponent(agentId)}/memories?${qs}`, { method: "GET", authToken });
    }

    case "stapler_delete_memory": {
      const id = String(args.memoryId ?? "").trim();
      if (!id) return { error: "memoryId is required" };
      return paperclipFetch(`${base}/api/agents/${encodeURIComponent(agentId)}/memories/${encodeURIComponent(id)}`, { method: "DELETE", authToken });
    }

    case "stapler_list_goals": {
      const limit = typeof args.limit === "number" ? args.limit : 20;
      return paperclipFetch(`${base}/api/companies/${encodeURIComponent(companyId)}/goals?limit=${limit}`, { method: "GET", authToken });
    }

    case "stapler_create_goal": {
      const title = String(args.title ?? "").trim();
      if (!title) return { error: "title is required" };
      const body: Record<string, unknown> = { title };
      if (typeof args.description === "string" && args.description.trim()) body.description = args.description.trim();
      if (typeof args.acceptanceCriteria === "string" && args.acceptanceCriteria.trim()) body.acceptanceCriteria = args.acceptanceCriteria.trim();
      return paperclipFetch(`${base}/api/companies/${encodeURIComponent(companyId)}/goals`, { method: "POST", body: JSON.stringify(body), authToken });
    }

    case "stapler_update_goal": {
      const id = String(args.goalId ?? "").trim();
      if (!id) return { error: "goalId is required" };
      const updates: Record<string, unknown> = {};
      if (typeof args.status === "string") updates.status = args.status;
      if (typeof args.title === "string") updates.title = args.title;
      if (typeof args.description === "string") updates.description = args.description;
      if (typeof args.acceptanceCriteria === "string") updates.acceptanceCriteria = args.acceptanceCriteria;
      return paperclipFetch(`${base}/api/companies/${encodeURIComponent(companyId)}/goals/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(updates), authToken });
    }

    case "stapler_list_company_memories": {
      const limit = typeof args.limit === "number" ? Math.min(Math.max(1, args.limit), 200) : 50;
      return paperclipFetch(`${base}/api/companies/${encodeURIComponent(companyId)}/memories?limit=${limit}`, { method: "GET", authToken });
    }

    case "stapler_list_outputs":
      return paperclipFetch(`${base}/api/companies/${encodeURIComponent(companyId)}/outputs`, { method: "GET", authToken });

    case "stapler_get_output": {
      const id = String(args.outputId ?? "").trim();
      if (!id) return { error: "outputId is required" };
      return paperclipFetch(`${base}/api/outputs/${encodeURIComponent(id)}`, { method: "GET", authToken });
    }

    case "stapler_propose_output": {
      const title = String(args.title ?? "").trim();
      if (!title) return { error: "title is required" };
      const body: Record<string, unknown> = { title };
      if (typeof args.description === "string" && args.description.trim()) body.description = args.description.trim();
      return paperclipFetch(`${base}/api/companies/${encodeURIComponent(companyId)}/outputs`, { method: "POST", body: JSON.stringify(body), authToken });
    }

    case "stapler_update_output_draft": {
      const id = String(args.outputId ?? "").trim();
      if (!id) return { error: "outputId is required" };
      const content = typeof args.content === "string" ? args.content : "";
      return paperclipFetch(`${base}/api/outputs/${encodeURIComponent(id)}/draft`, { method: "PATCH", body: JSON.stringify({ content }), authToken });
    }

    case "stapler_release_output_version": {
      const id = String(args.outputId ?? "").trim();
      if (!id) return { error: "outputId is required" };
      const body: Record<string, unknown> = {};
      if (typeof args.releaseNotes === "string" && args.releaseNotes.trim()) body.releaseNotes = args.releaseNotes.trim();
      return paperclipFetch(`${base}/api/outputs/${encodeURIComponent(id)}/versions`, { method: "POST", body: JSON.stringify(body), authToken });
    }

    case "stapler_decompose_goal": {
      const goalId = String(args.goalId ?? "").trim();
      if (!goalId) return { error: "goalId is required" };
      const assigneeAgentId =
        typeof args.assigneeAgentId === "string" && args.assigneeAgentId.trim()
          ? args.assigneeAgentId.trim()
          : agentId;
      const rawMax = Number(args.maxIssues);
      const maxIssues = Number.isFinite(rawMax) && rawMax > 0 ? Math.min(10, rawMax) : 5;
      return paperclipFetch(`${base}/api/goals/${encodeURIComponent(goalId)}/decompose`, { method: "POST", body: JSON.stringify({ assigneeAgentId, maxIssues }), authToken });
    }

    case "stapler_delegate_task": {
      const targetAgentId = String(args.agentId ?? "").trim();
      const task = String(args.task ?? "").trim();
      if (!targetAgentId) return { error: "agentId is required" };
      if (!task) return { error: "task is required" };
      const issueBody: Record<string, unknown> = {
        title: task,
        description: typeof args.context === "string" && args.context.trim() ? args.context.trim() : undefined,
        // Use assigneeAgentId — the field the issue API expects for agent assignment.
        // (assigneeId is a human-user field and is silently ignored for agent assignment.)
        assigneeAgentId: targetAgentId,
      };
      const issue = await paperclipFetch(`${base}/api/companies/${encodeURIComponent(companyId)}/issues`, { method: "POST", body: JSON.stringify(issueBody), authToken }) as Record<string, unknown>;
      if (issue?.error) return issue;
      const issueId = String(issue?.id ?? "");
      if (!issueId) return { error: "Failed to create delegation issue", detail: issue };
      // Include issueId in payload so the woken agent's run is bound to this issue
      // and picks up the correct context rather than starting unrelated work.
      await paperclipFetch(`${base}/api/agents/${encodeURIComponent(targetAgentId)}/wakeup`, {
        method: "POST",
        body: JSON.stringify({
          reason: `Delegated task: ${task.slice(0, 100)}`,
          payload: { issueId },
        }),
        authToken,
      });
      return {
        delegationId: issueId,
        issueUrl: `/issues/${issueId}`,
        status: "delegated",
        message: `Task delegated to agent ${targetAgentId}. Use stapler_check_delegation with delegationId "${issueId}" to check progress.`,
      };
    }

    case "stapler_check_delegation": {
      const delegationId = String(args.delegationId ?? "").trim();
      if (!delegationId) return { error: "delegationId is required" };
      const [issue, comments] = await Promise.all([
        paperclipFetch(`${base}/api/issues/${encodeURIComponent(delegationId)}`, { authToken }) as Promise<Record<string, unknown>>,
        paperclipFetch(`${base}/api/issues/${encodeURIComponent(delegationId)}/comments`, { authToken }) as Promise<unknown[]>,
      ]);
      if (issue?.error) return issue;
      const issueStatus = String(issue?.status ?? "");
      const status =
        issueStatus === "done" ? "done"
          : issueStatus === "in_progress" || issueStatus === "active" ? "in_progress"
            : issueStatus === "cancelled" ? "failed"
              : "pending";
      const agentComments = Array.isArray(comments)
        ? (comments as Array<Record<string, unknown>>).filter((c) => c.actorType === "agent" || c.type === "agent")
        : [];
      const latest = agentComments[agentComments.length - 1];
      return {
        delegationId,
        status,
        result: latest?.body ?? latest?.content ?? null,
        issueStatus,
        commentCount: agentComments.length,
      };
    }

    default:
      return { error: `Unknown Stapler tool: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// API context builder
// ---------------------------------------------------------------------------

export function buildStaplerApiContext(
  agent: { id: string; companyId: string },
  authToken?: string,
): StaplerApiContext {
  const runtimeHost = resolveHostForUrl(
    process.env.STAPLER_LISTEN_HOST ?? process.env.HOST ?? "localhost",
  );
  const runtimePort = process.env.STAPLER_LISTEN_PORT ?? process.env.PORT ?? "3100";
  const apiUrl = process.env.STAPLER_API_URL ?? `http://${runtimeHost}:${runtimePort}`;
  return { apiUrl, companyId: agent.companyId, agentId: agent.id, authToken };
}

function resolveHostForUrl(rawHost: string): string {
  const host = rawHost.trim();
  if (!host || host === "0.0.0.0" || host === "::") return "localhost";
  if (host.includes(":") && !host.startsWith("[") && !host.endsWith("]")) return `[${host}]`;
  return host;
}
