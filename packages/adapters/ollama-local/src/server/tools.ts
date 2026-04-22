/**
 * Stapler tool definitions and execution for the Ollama adapter.
 *
 * Ollama models that support function-calling (llama3.1, qwen2.5, mistral, etc.)
 * receive these tools at run-start. The adapter executes each tool call against
 * the Stapler API and feeds the results back to the model — giving ollama agents
 * the same ability to act on Stapler that Claude Code agents have via bash.
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
    properties: Record<string, { type: string; description?: string; enum?: string[]; items?: { type: string } }>;
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

export interface StaplerApiContext {
  apiUrl: string;
  companyId: string;
  agentId: string;
  authToken?: string;
}

// ---------------------------------------------------------------------------
// Tool schema — matches what Ollama expects in the `tools` request field
// ---------------------------------------------------------------------------

export const STAPLER_TOOLS: OllamaTool[] = [
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
        "Fetch details about a specific agent — their name, role, status, current config, and assigned issues. " +
        "Use to inspect an agent before delegating work or waking them.",
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
        "Hire a new AI agent for the company. Creates the agent with instructions and an adapter. " +
        "Use this when you need to staff a new role: engineer, designer, QA, researcher, etc. " +
        "After creation, use stapler_wake_agent to give it its first task.",
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
      name: "stapler_wake_agent",
      description:
        "Wake an agent and give it a task to work on. The agent will run immediately with the given reason. " +
        "Use this after hiring an agent or to delegate an urgent task. " +
        "Provide the issueId of the issue you want them to work on.",
      parameters: {
        type: "object",
        required: ["agentId", "reason"],
        properties: {
          agentId: { type: "string", description: "The agent ID (UUID) to wake" },
          reason: {
            type: "string",
            description: "Brief description of the task or reason for waking the agent",
          },
          issueId: {
            type: "string",
            description: "The issue ID to focus on (optional but recommended)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_save_memory",
      description:
        "Save a memory for yourself. Use to record decisions, learnings, context, or facts you want " +
        "to remember in future runs. Memories are automatically injected at run-start when relevant.",
      parameters: {
        type: "object",
        required: ["content"],
        properties: {
          content: {
            type: "string",
            description: "The memory content to save (plain text or markdown)",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags to categorise the memory, e.g. [\"decision\", \"architecture\"]",
          },
          expiresAt: {
            type: "string",
            description: "ISO 8601 datetime after which the memory expires, e.g. \"2026-12-31T00:00:00Z\". Omit for a permanent memory.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_search_memories",
      description:
        "Search your memories for relevant context. Use when you need to recall past decisions, " +
        "learnings, or facts before starting work.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", description: "Search query — describe what you want to recall" },
          limit: { type: "number", description: "Maximum memories to return (default: 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_list_goals",
      description: "List company goals. Use to understand strategic objectives and whether work is aligned.",
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
      name: "stapler_delete_memory",
      description:
        "Delete one of your own memories by ID. Use when a memory is outdated, incorrect, or no longer relevant.",
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
      name: "stapler_create_goal",
      description:
        "Create a new company goal with a title, description, and acceptance criteria. Use to define strategic objectives for the team.",
      parameters: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", description: "Short, clear goal title" },
          description: { type: "string", description: "Goal description (markdown supported)" },
          acceptanceCriteria: { type: "string", description: "Definition of done — what must be true for this goal to be achieved" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_update_goal",
      description:
        "Update an existing goal's status, description, or acceptance criteria by ID.",
      parameters: {
        type: "object",
        required: ["goalId"],
        properties: {
          goalId: { type: "string", description: "The goal ID to update" },
          status: {
            type: "string",
            enum: ["open", "in_progress", "achieved", "abandoned"],
            description: "New goal status",
          },
          title: { type: "string", description: "Updated goal title" },
          description: { type: "string", description: "Updated goal description" },
          acceptanceCriteria: { type: "string", description: "Updated acceptance criteria" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_list_company_memories",
      description:
        "List all shared company memories — notes that any agent in this company can read and write. " +
        "Use to recall shared context, decisions, or facts that apply across agents.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of memories to return (1–200). Defaults to 50.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_list_outputs",
      description:
        "List all company outputs — living documents that agents collaboratively produce and version " +
        "(e.g. a book in English, a product spec, a research report). " +
        "Returns title, status, latest version number, and draft availability for each.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_get_output",
      description:
        "Get a company output by ID, including the current draft content and full version history. " +
        "Use before editing the draft or releasing a new version.",
      parameters: {
        type: "object",
        properties: {
          outputId: { type: "string", description: "ID of the output to fetch." },
        },
        required: ["outputId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_propose_output",
      description:
        "Propose a new company output that needs CEO approval before agents can start working on it. " +
        "Examples: 'Book — English', 'Go-to-Market Strategy', 'Architecture Decision Record'. " +
        "A CEO approval issue is automatically created.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short name for the output (e.g. 'Book — English')." },
          description: { type: "string", description: "What this output is for and who it is for." },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_update_output_draft",
      description:
        "Overwrite the current working draft of an output. All agents share the same draft — " +
        "you are replacing whatever is there. Read the current draft first with stapler_get_output " +
        "if you want to extend rather than overwrite.",
      parameters: {
        type: "object",
        properties: {
          outputId: { type: "string", description: "ID of the output to update." },
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
      description:
        "Snapshot the current draft as a new immutable version (v1, v2, …). " +
        "The draft continues to evolve after the release — nothing is locked. " +
        "Only works on outputs with status 'active'.",
      parameters: {
        type: "object",
        properties: {
          outputId: { type: "string", description: "ID of the output to release." },
          releaseNotes: { type: "string", description: "Optional notes describing what changed in this version." },
        },
        required: ["outputId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_delegate_task",
      description:
        "Delegate a task to another agent in the same company. Creates an issue, " +
        "assigns it to the target agent, and wakes them immediately. Returns a " +
        "delegationId (issue ID) you can poll with stapler_check_delegation. " +
        "Use this to spawn subagents, divide parallel workstreams, or escalate " +
        "specialized work to a purpose-built agent.",
      parameters: {
        type: "object",
        properties: {
          agentId: {
            type: "string",
            description: "ID of the target agent to delegate to.",
          },
          task: {
            type: "string",
            description: "Task description — becomes the issue title and body.",
          },
          context: {
            type: "string",
            description: "Additional background or constraints for the target agent.",
          },
        },
        required: ["agentId", "task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stapler_check_delegation",
      description:
        "Check the status of a previously delegated task. Returns the current " +
        "status and, once done, the target agent's most recent comment as the result. " +
        "Poll every few minutes until status is 'done' or 'failed'.",
      parameters: {
        type: "object",
        properties: {
          delegationId: {
            type: "string",
            description: "The issue ID returned by stapler_delegate_task.",
          },
        },
        required: ["delegationId"],
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

export async function executeStaplerTool(
  call: OllamaToolCall,
  ctx: StaplerApiContext,
): Promise<unknown> {
  const { apiUrl, companyId, agentId, authToken } = ctx;
  const base = apiUrl.replace(/\/$/, "");
  const args = call.function.arguments ?? {};
  // Backward-compatibility alias: pre-rename agents still hold persisted
  // instruction bundles that tell the model to call paperclip_* tools.
  // Normalize the prefix so those calls dispatch to the same handlers as
  // the new stapler_* names. Remove after a migration rewrites bundles.
  const name = call.function.name.startsWith("paperclip_")
    ? "stapler_" + call.function.name.slice("paperclip_".length)
    : call.function.name;

  switch (name) {
    case "stapler_get_issue": {
      const id = String(args.issueId ?? "");
      if (!id) return { error: "issueId is required" };
      return paperclipFetch(`${base}/api/issues/${encodeURIComponent(id)}`, {
        method: "GET",
        authToken,
      });
    }

    case "stapler_list_issues": {
      const limit = typeof args.limit === "number" ? args.limit : 20;
      const status = typeof args.status === "string" ? args.status : null;
      const qs = new URLSearchParams({ limit: String(limit) });
      if (status) qs.set("status", status);
      return paperclipFetch(`${base}/api/companies/${encodeURIComponent(companyId)}/issues?${qs}`, {
        method: "GET",
        authToken,
      });
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
      return paperclipFetch(`${base}/api/companies/${encodeURIComponent(companyId)}/issues`, {
        method: "POST",
        body: JSON.stringify(body),
        authToken,
      });
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
      return paperclipFetch(`${base}/api/issues/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
        authToken,
      });
    }

    case "stapler_post_comment": {
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

    case "stapler_list_agents": {
      return paperclipFetch(`${base}/api/companies/${encodeURIComponent(companyId)}/agents`, {
        method: "GET",
        authToken,
      });
    }

    case "stapler_get_agent": {
      // Resolve "me" / "self" to the agent's own ID so models can
      // self-identify without needing to know their UUID.
      const rawId = String(args.agentId ?? "").trim();
      const id = rawId === "me" || rawId === "self" ? agentId : rawId;
      if (!id) return { error: "agentId is required" };
      return paperclipFetch(`${base}/api/agents/${encodeURIComponent(id)}`, {
        method: "GET",
        authToken,
      });
    }

    case "stapler_create_agent": {
      const adapterType = typeof args.adapterType === "string" ? args.adapterType : "ollama_local";
      const model = typeof args.model === "string" && args.model.trim() ? args.model.trim() : undefined;
      const config: Record<string, unknown> = {};
      if (model) config.model = model;
      if (typeof args.instructions === "string" && args.instructions.trim()) {
        config.system = args.instructions.trim();
      }
      // Disable raw skill injection for new agents by default so they start lean
      config.paperclipRuntimeSkills = [];

      const agentName = String(args.name ?? "").trim();
      if (!agentName) return { error: "name is required" };

      const body: Record<string, unknown> = {
        name: agentName,
        role: typeof args.role === "string" ? args.role : "general",
        adapterType,
        adapterConfig: config,
        // Enable heartbeat so the agent automatically picks up assigned work.
        // intervalSec must be nested inside heartbeat — parseHeartbeatPolicy
        // reads runtimeConfig.heartbeat.intervalSec, not a top-level field.
        runtimeConfig: { heartbeat: { enabled: true, intervalSec: 300 } },
      };
      // Use /agent-hires — the agent-safe endpoint that respects canCreateAgents permission
      const result = await paperclipFetch(
        `${base}/api/companies/${encodeURIComponent(companyId)}/agent-hires`,
        { method: "POST", body: JSON.stringify(body), authToken },
      );
      return result;
    }

    case "stapler_wake_agent": {
      const id = String(args.agentId ?? "");
      if (!id) return { error: "agentId is required" };
      const reason = typeof args.reason === "string" ? args.reason.trim() : "";
      if (!reason) return { error: "reason is required" };
      const wakeBody: Record<string, unknown> = {
        source: "on_demand",
        reason,
      };
      if (typeof args.issueId === "string" && args.issueId.trim()) {
        wakeBody.payload = { issueId: args.issueId.trim() };
      }
      return paperclipFetch(`${base}/api/agents/${encodeURIComponent(id)}/wakeup`, {
        method: "POST",
        body: JSON.stringify(wakeBody),
        authToken,
      });
    }

    case "stapler_save_memory": {
      const content = typeof args.content === "string" ? args.content.trim() : "";
      if (!content) return { error: "content is required" };
      // Accept array (schema-compliant) or legacy comma-string (graceful fallback).
      const tags: string[] = Array.isArray(args.tags)
        ? (args.tags as unknown[]).map(String).map((t) => t.trim()).filter(Boolean)
        : typeof args.tags === "string" && args.tags.trim()
          ? args.tags.split(",").map((t) => t.trim()).filter(Boolean)
          : [];
      const memBody: Record<string, unknown> = { content, tags };
      if (typeof args.expiresAt === "string" && args.expiresAt.trim()) {
        memBody.expiresAt = args.expiresAt.trim();
      }
      return paperclipFetch(`${base}/api/agents/${encodeURIComponent(agentId)}/memories`, {
        method: "POST",
        body: JSON.stringify(memBody),
        authToken,
      });
    }

    case "stapler_search_memories": {
      const q = typeof args.query === "string" ? args.query.trim() : "";
      if (!q) return { error: "query is required" };
      const limit = typeof args.limit === "number" ? args.limit : 10;
      const qs = new URLSearchParams({ q, limit: String(limit) });
      return paperclipFetch(
        `${base}/api/agents/${encodeURIComponent(agentId)}/memories?${qs}`,
        { method: "GET", authToken },
      );
    }

    case "stapler_list_goals": {
      const limit = typeof args.limit === "number" ? args.limit : 20;
      return paperclipFetch(
        `${base}/api/companies/${encodeURIComponent(companyId)}/goals?limit=${limit}`,
        { method: "GET", authToken },
      );
    }

    case "stapler_delete_memory": {
      const id = String(args.memoryId ?? "").trim();
      if (!id) return { error: "memoryId is required" };
      return paperclipFetch(
        `${base}/api/agents/${encodeURIComponent(agentId)}/memories/${encodeURIComponent(id)}`,
        { method: "DELETE", authToken },
      );
    }

    case "stapler_create_goal": {
      const title = String(args.title ?? "").trim();
      if (!title) return { error: "title is required" };
      const body: Record<string, unknown> = { title };
      if (typeof args.description === "string" && args.description.trim()) {
        body.description = args.description.trim();
      }
      if (typeof args.acceptanceCriteria === "string" && args.acceptanceCriteria.trim()) {
        body.acceptanceCriteria = args.acceptanceCriteria.trim();
      }
      return paperclipFetch(
        `${base}/api/companies/${encodeURIComponent(companyId)}/goals`,
        { method: "POST", body: JSON.stringify(body), authToken },
      );
    }

    case "stapler_update_goal": {
      const id = String(args.goalId ?? "").trim();
      if (!id) return { error: "goalId is required" };
      const updates: Record<string, unknown> = {};
      if (typeof args.status === "string") updates.status = args.status;
      if (typeof args.title === "string") updates.title = args.title;
      if (typeof args.description === "string") updates.description = args.description;
      if (typeof args.acceptanceCriteria === "string") updates.acceptanceCriteria = args.acceptanceCriteria;
      return paperclipFetch(
        `${base}/api/companies/${encodeURIComponent(companyId)}/goals/${encodeURIComponent(id)}`,
        { method: "PATCH", body: JSON.stringify(updates), authToken },
      );
    }

    case "stapler_list_company_memories": {
      const limit = typeof args.limit === "number" ? Math.min(Math.max(1, args.limit), 200) : 50;
      return paperclipFetch(
        `${base}/api/companies/${encodeURIComponent(companyId)}/memories?limit=${limit}`,
        { method: "GET", authToken },
      );
    }

    case "stapler_list_outputs":
      return paperclipFetch(
        `${base}/api/companies/${encodeURIComponent(companyId)}/outputs`,
        { method: "GET", authToken },
      );

    case "stapler_get_output": {
      const id = String(args.outputId ?? "").trim();
      if (!id) return { error: "outputId is required" };
      return paperclipFetch(
        `${base}/api/outputs/${encodeURIComponent(id)}`,
        { method: "GET", authToken },
      );
    }

    case "stapler_propose_output": {
      const title = String(args.title ?? "").trim();
      if (!title) return { error: "title is required" };
      const body: Record<string, unknown> = { title };
      if (typeof args.description === "string" && args.description.trim()) {
        body.description = args.description.trim();
      }
      return paperclipFetch(
        `${base}/api/companies/${encodeURIComponent(companyId)}/outputs`,
        { method: "POST", body: JSON.stringify(body), authToken },
      );
    }

    case "stapler_update_output_draft": {
      const id = String(args.outputId ?? "").trim();
      if (!id) return { error: "outputId is required" };
      const content = typeof args.content === "string" ? args.content : "";
      return paperclipFetch(
        `${base}/api/outputs/${encodeURIComponent(id)}/draft`,
        { method: "PATCH", body: JSON.stringify({ content }), authToken },
      );
    }

    case "stapler_release_output_version": {
      const id = String(args.outputId ?? "").trim();
      if (!id) return { error: "outputId is required" };
      const body: Record<string, unknown> = {};
      if (typeof args.releaseNotes === "string" && args.releaseNotes.trim()) {
        body.releaseNotes = args.releaseNotes.trim();
      }
      return paperclipFetch(
        `${base}/api/outputs/${encodeURIComponent(id)}/versions`,
        { method: "POST", body: JSON.stringify(body), authToken },
      );
    }

    case "stapler_delegate_task": {
      const targetAgentId = String(args.agentId ?? "").trim();
      const task = String(args.task ?? "").trim();
      if (!targetAgentId) return { error: "agentId is required" };
      if (!task) return { error: "task is required" };

      const issueBody: Record<string, unknown> = {
        title: task,
        description: typeof args.context === "string" && args.context.trim()
          ? args.context.trim()
          : undefined,
        assigneeId: targetAgentId,
      };

      const issue = await paperclipFetch(
        `${base}/api/companies/${encodeURIComponent(companyId)}/issues`,
        { method: "POST", body: JSON.stringify(issueBody), authToken },
      ) as Record<string, unknown>;

      if (issue?.error) return issue;

      const issueId = String(issue?.id ?? "");
      if (!issueId) return { error: "Failed to create delegation issue", detail: issue };

      // Wake the target agent immediately
      await paperclipFetch(
        `${base}/api/agents/${encodeURIComponent(targetAgentId)}/wakeup`,
        { method: "POST", body: JSON.stringify({ reason: `Delegated task: ${task.slice(0, 100)}` }), authToken },
      );

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
        ? (comments as Array<Record<string, unknown>>).filter(
            (c) => c.actorType === "agent" || c.type === "agent",
          )
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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the API context from the execution environment.
 * Falls back to process.env for the API URL (server-side, always set).
 */
export function buildStaplerApiContext(
  agent: { id: string; companyId: string },
  authToken?: string,
): StaplerApiContext {
  const runtimeHost = resolveHostForUrl(
    process.env.STAPLER_LISTEN_HOST ?? process.env.HOST ?? "localhost",
  );
  const runtimePort = process.env.STAPLER_LISTEN_PORT ?? process.env.PORT ?? "3100";
  const apiUrl = process.env.STAPLER_API_URL ?? `http://${runtimeHost}:${runtimePort}`;
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
