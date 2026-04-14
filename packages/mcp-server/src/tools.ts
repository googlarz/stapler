import { z } from "zod";
import {
  addIssueCommentSchema,
  checkoutIssueSchema,
  createApprovalSchema,
  createIssueSchema,
  updateIssueSchema,
  upsertIssueDocumentSchema,
  linkIssueApprovalSchema,
} from "@paperclipai/shared";
import { PaperclipApiClient } from "./client.js";
import { formatErrorResponse, formatTextResponse } from "./format.js";

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.AnyZodObject;
  execute: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;
}

function makeTool<TSchema extends z.ZodRawShape>(
  name: string,
  description: string,
  schema: z.ZodObject<TSchema>,
  execute: (input: z.infer<typeof schema>) => Promise<unknown>,
): ToolDefinition {
  return {
    name,
    description,
    schema,
    execute: async (input) => {
      try {
        const parsed = schema.parse(input);
        return formatTextResponse(await execute(parsed));
      } catch (error) {
        return formatErrorResponse(error);
      }
    },
  };
}

function parseOptionalJson(raw: string | undefined | null): unknown {
  if (!raw || raw.trim().length === 0) return undefined;
  return JSON.parse(raw);
}

const companyIdOptional = z.string().uuid().optional().nullable();
const agentIdOptional = z.string().uuid().optional().nullable();
const issueIdSchema = z.string().min(1);
const projectIdSchema = z.string().min(1);
const goalIdSchema = z.string().uuid();
const approvalIdSchema = z.string().uuid();
const documentKeySchema = z.string().trim().min(1).max(64);

const listIssuesSchema = z.object({
  companyId: companyIdOptional,
  status: z.string().optional(),
  projectId: z.string().uuid().optional(),
  assigneeAgentId: z.string().uuid().optional(),
  participantAgentId: z.string().uuid().optional(),
  assigneeUserId: z.string().optional(),
  touchedByUserId: z.string().optional(),
  inboxArchivedByUserId: z.string().optional(),
  unreadForUserId: z.string().optional(),
  labelId: z.string().uuid().optional(),
  executionWorkspaceId: z.string().uuid().optional(),
  originKind: z.string().optional(),
  originId: z.string().optional(),
  includeRoutineExecutions: z.boolean().optional(),
  q: z.string().optional(),
});

const listCommentsSchema = z.object({
  issueId: issueIdSchema,
  after: z.string().uuid().optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

const upsertDocumentToolSchema = z.object({
  issueId: issueIdSchema,
  key: documentKeySchema,
  title: z.string().trim().max(200).nullable().optional(),
  format: z.enum(["markdown"]).default("markdown"),
  body: z.string().max(524288),
  changeSummary: z.string().trim().max(500).nullable().optional(),
  baseRevisionId: z.string().uuid().nullable().optional(),
});

const createIssueToolSchema = z.object({
  companyId: companyIdOptional,
}).merge(createIssueSchema);

const updateIssueToolSchema = z.object({
  issueId: issueIdSchema,
}).merge(updateIssueSchema);

const checkoutIssueToolSchema = z.object({
  issueId: issueIdSchema,
  agentId: agentIdOptional,
  expectedStatuses: checkoutIssueSchema.shape.expectedStatuses.optional(),
});

const addCommentToolSchema = z.object({
  issueId: issueIdSchema,
}).merge(addIssueCommentSchema);

const approvalDecisionSchema = z.object({
  approvalId: approvalIdSchema,
  action: z.enum(["approve", "reject", "requestRevision", "resubmit"]),
  decisionNote: z.string().optional(),
  payloadJson: z.string().optional(),
});

const createApprovalToolSchema = z.object({
  companyId: companyIdOptional,
}).merge(createApprovalSchema);

const apiRequestSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().min(1),
  jsonBody: z.string().optional(),
});

// Agent memory tools. These all operate on the calling agent's own
// memory store — there is no tool-level `agentId` parameter because
// the server would reject cross-agent calls anyway (see
// `assertAgentIdentity` in `server/src/routes/authz.ts`). The tools
// resolve the target agent from `client.resolveAgentId()`, which
// reads `PAPERCLIP_AGENT_ID` from the MCP config and throws if
// missing — same pattern as the existing `paperclipMe` tool.

const memorySaveSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "content is required")
    .max(4096, "content must be at most 4096 characters"),
  tags: z.array(z.string().trim().min(1).max(64)).max(16).optional(),
  /**
   * ISO 8601 datetime after which the memory is automatically excluded from
   * searches and run-start injection. Use for time-scoped notes
   * ("today's sprint focus", "current PR under review"). Must be in the future.
   */
  expiresAt: z
    .string()
    .datetime({ message: "expiresAt must be an ISO 8601 datetime" })
    .refine((v) => new Date(v) > new Date(), { message: "expiresAt must be in the future" })
    .optional(),
});

const memorySearchSchema = z.object({
  q: z.string().trim().min(1).max(512),
  limit: z.number().int().positive().max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(16).optional(),
});

const memoryListSchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().min(0).max(10_000).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(16).optional(),
});

const memoryDeleteSchema = z.object({
  id: z.string().uuid(),
});

export function createToolDefinitions(client: PaperclipApiClient): ToolDefinition[] {
  return [
    makeTool(
      "me",
      "Get the current authenticated Paperclip actor details",
      z.object({}),
      async () => client.requestJson("GET", "/agents/me"),
    ),
    makeTool(
      "inboxLite",
      "Get the current authenticated agent inbox-lite assignment list",
      z.object({}),
      async () => client.requestJson("GET", "/agents/me/inbox-lite"),
    ),
    makeTool(
      "listAgents",
      "List agents in a company",
      z.object({ companyId: companyIdOptional }),
      async ({ companyId }) => client.requestJson("GET", `/companies/${client.resolveCompanyId(companyId)}/agents`),
    ),
    makeTool(
      "getAgent",
      "Get a single agent by id",
      z.object({ agentId: z.string().min(1), companyId: companyIdOptional }),
      async ({ agentId, companyId }) => {
        const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
        return client.requestJson("GET", `/agents/${encodeURIComponent(agentId)}${qs}`);
      },
    ),
    makeTool(
      "listIssues",
      "List issues for a company with optional filters",
      listIssuesSchema,
      async (input) => {
        const companyId = client.resolveCompanyId(input.companyId);
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(input)) {
          if (key === "companyId" || value === undefined || value === null) continue;
          params.set(key, String(value));
        }
        const qs = params.toString();
        return client.requestJson("GET", `/companies/${companyId}/issues${qs ? `?${qs}` : ""}`);
      },
    ),
    makeTool(
      "getIssue",
      "Get a single issue by UUID or identifier",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}`),
    ),
    makeTool(
      "getHeartbeatContext",
      "Get compact heartbeat context for an issue",
      z.object({ issueId: issueIdSchema, wakeCommentId: z.string().uuid().optional() }),
      async ({ issueId, wakeCommentId }) => {
        const qs = wakeCommentId ? `?wakeCommentId=${encodeURIComponent(wakeCommentId)}` : "";
        return client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/heartbeat-context${qs}`);
      },
    ),
    makeTool(
      "listComments",
      "List issue comments with incremental options",
      listCommentsSchema,
      async ({ issueId, after, order, limit }) => {
        const params = new URLSearchParams();
        if (after) params.set("after", after);
        if (order) params.set("order", order);
        if (limit) params.set("limit", String(limit));
        const qs = params.toString();
        return client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/comments${qs ? `?${qs}` : ""}`);
      },
    ),
    makeTool(
      "getComment",
      "Get a specific issue comment by id",
      z.object({ issueId: issueIdSchema, commentId: z.string().uuid() }),
      async ({ issueId, commentId }) =>
        client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/comments/${encodeURIComponent(commentId)}`),
    ),
    makeTool(
      "listIssueApprovals",
      "List approvals linked to an issue",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/approvals`),
    ),
    makeTool(
      "listDocuments",
      "List issue documents",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/documents`),
    ),
    makeTool(
      "getDocument",
      "Get one issue document by key",
      z.object({ issueId: issueIdSchema, key: documentKeySchema }),
      async ({ issueId, key }) =>
        client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/documents/${encodeURIComponent(key)}`),
    ),
    makeTool(
      "listDocumentRevisions",
      "List revisions for an issue document",
      z.object({ issueId: issueIdSchema, key: documentKeySchema }),
      async ({ issueId, key }) =>
        client.requestJson(
          "GET",
          `/issues/${encodeURIComponent(issueId)}/documents/${encodeURIComponent(key)}/revisions`,
        ),
    ),
    makeTool(
      "listProjects",
      "List projects in a company",
      z.object({ companyId: companyIdOptional }),
      async ({ companyId }) => client.requestJson("GET", `/companies/${client.resolveCompanyId(companyId)}/projects`),
    ),
    makeTool(
      "getProject",
      "Get a project by id or company-scoped short reference",
      z.object({ projectId: projectIdSchema, companyId: companyIdOptional }),
      async ({ projectId, companyId }) => {
        const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
        return client.requestJson("GET", `/projects/${encodeURIComponent(projectId)}${qs}`);
      },
    ),
    makeTool(
      "listGoals",
      "List goals in a company",
      z.object({ companyId: companyIdOptional }),
      async ({ companyId }) => client.requestJson("GET", `/companies/${client.resolveCompanyId(companyId)}/goals`),
    ),
    makeTool(
      "getGoal",
      "Get a goal by id",
      z.object({ goalId: goalIdSchema }),
      async ({ goalId }) => client.requestJson("GET", `/goals/${encodeURIComponent(goalId)}`),
    ),
    makeTool(
      "listApprovals",
      "List approvals in a company",
      z.object({ companyId: companyIdOptional, status: z.string().optional() }),
      async ({ companyId, status }) => {
        const qs = status ? `?status=${encodeURIComponent(status)}` : "";
        return client.requestJson("GET", `/companies/${client.resolveCompanyId(companyId)}/approvals${qs}`);
      },
    ),
    makeTool(
      "createApproval",
      "Create a board approval request, optionally linked to one or more issues",
      createApprovalToolSchema,
      async ({ companyId, ...body }) =>
        client.requestJson("POST", `/companies/${client.resolveCompanyId(companyId)}/approvals`, {
          body,
        }),
    ),
    makeTool(
      "getApproval",
      "Get an approval by id",
      z.object({ approvalId: approvalIdSchema }),
      async ({ approvalId }) => client.requestJson("GET", `/approvals/${encodeURIComponent(approvalId)}`),
    ),
    makeTool(
      "getApprovalIssues",
      "List issues linked to an approval",
      z.object({ approvalId: approvalIdSchema }),
      async ({ approvalId }) => client.requestJson("GET", `/approvals/${encodeURIComponent(approvalId)}/issues`),
    ),
    makeTool(
      "listApprovalComments",
      "List comments for an approval",
      z.object({ approvalId: approvalIdSchema }),
      async ({ approvalId }) => client.requestJson("GET", `/approvals/${encodeURIComponent(approvalId)}/comments`),
    ),
    makeTool(
      "createIssue",
      "Create a new issue",
      createIssueToolSchema,
      async ({ companyId, ...body }) =>
        client.requestJson("POST", `/companies/${client.resolveCompanyId(companyId)}/issues`, { body }),
    ),
    makeTool(
      "updateIssue",
      "Patch an issue, optionally including a comment",
      updateIssueToolSchema,
      async ({ issueId, ...body }) =>
        client.requestJson("PATCH", `/issues/${encodeURIComponent(issueId)}`, { body }),
    ),
    makeTool(
      "checkoutIssue",
      "Checkout an issue for an agent",
      checkoutIssueToolSchema,
      async ({ issueId, agentId, expectedStatuses }) =>
        client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/checkout`, {
          body: {
            agentId: client.resolveAgentId(agentId),
            expectedStatuses: expectedStatuses ?? ["todo", "backlog", "blocked"],
          },
        }),
    ),
    makeTool(
      "releaseIssue",
      "Release an issue checkout",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/release`, { body: {} }),
    ),
    makeTool(
      "addComment",
      "Add a comment to an issue",
      addCommentToolSchema,
      async ({ issueId, ...body }) =>
        client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/comments`, { body }),
    ),
    makeTool(
      "upsertIssueDocument",
      "Create or update an issue document",
      upsertDocumentToolSchema,
      async ({ issueId, key, ...body }) =>
        client.requestJson(
          "PUT",
          `/issues/${encodeURIComponent(issueId)}/documents/${encodeURIComponent(key)}`,
          { body },
        ),
    ),
    makeTool(
      "restoreIssueDocumentRevision",
      "Restore a prior revision of an issue document",
      z.object({
        issueId: issueIdSchema,
        key: documentKeySchema,
        revisionId: z.string().uuid(),
      }),
      async ({ issueId, key, revisionId }) =>
        client.requestJson(
          "POST",
          `/issues/${encodeURIComponent(issueId)}/documents/${encodeURIComponent(key)}/revisions/${encodeURIComponent(revisionId)}/restore`,
          { body: {} },
        ),
    ),
    makeTool(
      "linkIssueApproval",
      "Link an approval to an issue",
      z.object({ issueId: issueIdSchema }).merge(linkIssueApprovalSchema),
      async ({ issueId, approvalId }) =>
        client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/approvals`, {
          body: { approvalId },
        }),
    ),
    makeTool(
      "unlinkIssueApproval",
      "Unlink an approval from an issue",
      z.object({ issueId: issueIdSchema, approvalId: approvalIdSchema }),
      async ({ issueId, approvalId }) =>
        client.requestJson(
          "DELETE",
          `/issues/${encodeURIComponent(issueId)}/approvals/${encodeURIComponent(approvalId)}`,
        ),
    ),
    makeTool(
      "approvalDecision",
      "Approve, reject, request revision, or resubmit an approval",
      approvalDecisionSchema,
      async ({ approvalId, action, decisionNote, payloadJson }) => {
        const path =
          action === "approve"
            ? `/approvals/${encodeURIComponent(approvalId)}/approve`
            : action === "reject"
              ? `/approvals/${encodeURIComponent(approvalId)}/reject`
              : action === "requestRevision"
                ? `/approvals/${encodeURIComponent(approvalId)}/request-revision`
                : `/approvals/${encodeURIComponent(approvalId)}/resubmit`;

        const body =
          action === "resubmit"
            ? { payload: parseOptionalJson(payloadJson) ?? {} }
            : { decisionNote };

        return client.requestJson("POST", path, { body });
      },
    ),
    makeTool(
      "addApprovalComment",
      "Add a comment to an approval",
      z.object({ approvalId: approvalIdSchema, body: z.string().min(1) }),
      async ({ approvalId, body }) =>
        client.requestJson("POST", `/approvals/${encodeURIComponent(approvalId)}/comments`, {
          body: { body },
        }),
    ),
    makeTool(
      "apiRequest",
      "Make a JSON request to an existing Paperclip /api endpoint for unsupported operations",
      apiRequestSchema,
      async ({ method, path, jsonBody }) => {
        if (!path.startsWith("/")) {
          throw new Error("path must start with / and be relative to /api");
        }
        // Decode percent-encoded characters before checking for traversal so
        // that %2e%2e and other encoded variants are caught alongside literal '..'.
        let decodedPath: string;
        try {
          decodedPath = decodeURIComponent(path);
        } catch {
          throw new Error("path contains invalid percent-encoding");
        }
        if (decodedPath.includes("..")) {
          throw new Error("path must not contain '..'");
        }
        return client.requestJson(method, path, {
          body: parseOptionalJson(jsonBody),
        });
      },
    ),
    makeTool(
      "memorySave",
      "Save a short factual memory for your agent (idempotent by content hash). Use for user preferences, decisions, observations you will need later. Do not use as a run scratchpad — use issue comments for that.",
      memorySaveSchema,
      async ({ content, tags, expiresAt }) => {
        const agentId = client.resolveAgentId();
        return client.requestJson(
          "POST",
          `/agents/${encodeURIComponent(agentId)}/memories`,
          { body: { content, tags, expiresAt } },
        );
      },
    ),
    makeTool(
      "memorySearch",
      "Search your agent's episodic memories. Uses semantic similarity (OpenAI embeddings) when available, falls back to keyword search. Wiki pages are excluded — they are already in your context. Natural-language phrases work well.",
      memorySearchSchema,
      async ({ q, limit, tags }) => {
        const agentId = client.resolveAgentId();
        const params = new URLSearchParams();
        params.set("q", q);
        // Exclude wiki pages — they are already injected at run-start.
        params.set("excludeWiki", "true");
        if (limit !== undefined) params.set("limit", String(limit));
        if (tags && tags.length > 0) params.set("tags", tags.join(","));
        return client.requestJson(
          "GET",
          `/agents/${encodeURIComponent(agentId)}/memories?${params.toString()}`,
        );
      },
    ),
    makeTool(
      "memoryList",
      "List your agent's most recent memories. Optional tag AND filter and pagination.",
      memoryListSchema,
      async ({ limit, offset, tags }) => {
        const agentId = client.resolveAgentId();
        const params = new URLSearchParams();
        if (limit !== undefined) params.set("limit", String(limit));
        if (offset !== undefined) params.set("offset", String(offset));
        if (tags && tags.length > 0) params.set("tags", tags.join(","));
        const qs = params.toString();
        return client.requestJson(
          "GET",
          `/agents/${encodeURIComponent(agentId)}/memories${qs ? `?${qs}` : ""}`,
        );
      },
    ),
    makeTool(
      "memoryDelete",
      "Delete one of your agent's memories by id. No-op returns 404 if the id is not yours or does not exist.",
      memoryDeleteSchema,
      async ({ id }) => {
        const agentId = client.resolveAgentId();
        return client.requestJson(
          "DELETE",
          `/agents/${encodeURIComponent(agentId)}/memories/${encodeURIComponent(id)}`,
        );
      },
    ),
    makeTool(
      "wikiUpsert",
      "Create or fully replace a named wiki page in your memory. Wiki pages are compiled knowledge documents (Karpathy-style) that survive across runs. Use a stable slug like 'preferences', 'tech-stack', 'project-context'. The content replaces the previous page entirely — read it first with wikiGet if you want to merge.",
      z.object({
        slug: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/, "slug must be lowercase alphanumeric with hyphens/underscores"),
        content: z.string().trim().min(1).max(4096),
        tags: z.array(z.string().trim().min(1).max(64)).max(16).optional(),
      }),
      async ({ slug, content, tags }) => {
        const agentId = client.resolveAgentId();
        return client.requestJson("PUT", `/agents/${encodeURIComponent(agentId)}/memories/wiki/${encodeURIComponent(slug)}`, { body: { content, tags } });
      },
    ),
    makeTool(
      "wikiGet",
      "Read a named wiki page from your memory by slug.",
      z.object({ slug: z.string().trim().min(1).max(64) }),
      async ({ slug }) => {
        const agentId = client.resolveAgentId();
        return client.requestJson("GET", `/agents/${encodeURIComponent(agentId)}/memories/wiki/${encodeURIComponent(slug)}`);
      },
    ),
    makeTool(
      "wikiList",
      "List all your named wiki pages (slugs and first 120 chars of content). Use this to see your knowledge base index before reading or updating pages.",
      z.object({}),
      async () => {
        const agentId = client.resolveAgentId();
        return client.requestJson("GET", `/agents/${encodeURIComponent(agentId)}/memories/wiki`);
      },
    ),
    makeTool(
      "wikiDelete",
      "Delete a named wiki page from your knowledge base by slug. Use when a compiled knowledge page is no longer relevant or has been superseded.",
      z.object({ slug: z.string().trim().min(1).max(64) }),
      async ({ slug }) => {
        const agentId = client.resolveAgentId();
        return client.requestJson(
          "DELETE",
          `/agents/${encodeURIComponent(agentId)}/memories/wiki/${encodeURIComponent(slug)}`,
        );
      },
    ),
    makeTool(
      "memoryStats",
      "Fetch your agent's memory health statistics: episodic count and bytes, wiki page count and bytes, totals, and configured limits. Useful for self-monitoring before approaching the episodic cap.",
      z.object({}),
      async () => {
        const agentId = client.resolveAgentId();
        return client.requestJson("GET", `/agents/${encodeURIComponent(agentId)}/memories/stats`);
      },
    ),
    makeTool(
      "agentWake",
      "Wake another agent in your company to perform a task. The target agent receives your reason as its wake context — write it as a clear task instruction. Use payload for structured data the agent will need (e.g. issueId, references). Returns the queued run or a skipped status if the agent is already running. Both agents must be in the same company.",
      z.object({
        targetAgentId: z.string().uuid("targetAgentId must be a valid agent UUID"),
        reason: z
          .string()
          .trim()
          .min(1, "reason is required — it becomes the agent's wake context")
          .max(1000),
        payloadJson: z
          .string()
          .optional()
          .describe("Optional JSON object to pass to the agent as structured context"),
        idempotencyKey: z
          .string()
          .min(1)
          .max(255)
          .optional()
          .describe("Optional key to deduplicate concurrent wake requests"),
      }),
      async ({ targetAgentId, reason, payloadJson, idempotencyKey }) =>
        client.requestJson("POST", `/agents/${encodeURIComponent(targetAgentId)}/wakeup`, {
          body: {
            source: "automation",
            triggerDetail: "callback",
            reason,
            payload: parseOptionalJson(payloadJson),
            idempotencyKey: idempotencyKey ?? null,
          },
        }),
    ),
    makeTool(
      "agentPeerSearch",
      "Search another agent's episodic memories by ID. Both agents must belong to the same company. Useful for cross-agent knowledge sharing — e.g. the Bavaria agent reading notes saved by the Berlin agent. Includes wiki pages (unlike memorySearch). Uses semantic search when available.",
      z.object({
        targetAgentId: z.string().uuid("targetAgentId must be a valid agent UUID"),
        q: z.string().trim().min(1).max(512),
        limit: z.number().int().positive().max(50).optional(),
        tags: z.array(z.string().trim().min(1).max(64)).max(16).optional(),
      }),
      async ({ targetAgentId, q, limit, tags }) => {
        const params = new URLSearchParams();
        params.set("q", q);
        if (limit !== undefined) params.set("limit", String(limit));
        if (tags && tags.length > 0) params.set("tags", tags.join(","));
        return client.requestJson(
          "GET",
          `/agents/${encodeURIComponent(targetAgentId)}/memories/peer-search?${params.toString()}`,
        );
      },
    ),
    // ── Company memory tools ───────────────────────────────────────────────
    makeTool(
      "companyMemorySave",
      "Save a short episodic memory to the company's shared memory pool. Available to all agents and board users. Idempotent by content hash — saving the same text twice returns the existing row. Do not use for temporary notes; use issue comments instead.",
      z.object({
        content: z
          .string()
          .trim()
          .min(1, "content is required")
          .max(4096, "content must be at most 4096 characters"),
        tags: z.array(z.string().trim().min(1).max(64)).max(16).optional(),
        expiresAt: z
          .string()
          .datetime({ message: "expiresAt must be an ISO 8601 datetime" })
          .refine((v) => new Date(v) > new Date(), { message: "expiresAt must be in the future" })
          .optional(),
      }),
      async ({ content, tags, expiresAt }) => {
        const companyId = client.resolveCompanyId();
        return client.requestJson(
          "POST",
          `/companies/${encodeURIComponent(companyId)}/memories`,
          { body: { content, tags, expiresAt } },
        );
      },
    ),
    makeTool(
      "companyMemoryList",
      "List company episodic memories, newest first. Use companyMemorySearch when you have a keyword — listing is for browsing or pagination.",
      z.object({
        limit: z.number().int().positive().max(100).optional(),
        offset: z.number().int().min(0).optional(),
        tags: z.array(z.string().trim().min(1).max(64)).max(8).optional(),
      }),
      async ({ limit, offset, tags }) => {
        const companyId = client.resolveCompanyId();
        const params = new URLSearchParams();
        if (limit !== undefined) params.set("limit", String(limit));
        if (offset !== undefined) params.set("offset", String(offset));
        if (tags && tags.length > 0) params.set("tags", tags.join(","));
        const qs = params.toString();
        return client.requestJson(
          "GET",
          `/companies/${encodeURIComponent(companyId)}/memories${qs ? `?${qs}` : ""}`,
        );
      },
    ),
    makeTool(
      "companyMemoryDelete",
      "Delete a company episodic memory by id. Returns 404 if the id does not exist or belongs to a different company.",
      z.object({ id: z.string().uuid() }),
      async ({ id }) => {
        const companyId = client.resolveCompanyId();
        return client.requestJson(
          "DELETE",
          `/companies/${encodeURIComponent(companyId)}/memories/${encodeURIComponent(id)}`,
        );
      },
    ),
    makeTool(
      "companyMemoryStats",
      "Fetch the company's shared memory health statistics: episodic count and bytes, wiki page count and bytes, and totals. Useful for checking pool usage before writing or to audit shared knowledge volume.",
      z.object({}),
      async () => {
        const companyId = client.resolveCompanyId();
        return client.requestJson("GET", `/companies/${encodeURIComponent(companyId)}/memories/stats`);
      },
    ),
    makeTool(
      "companyMemorySearch",
      "Search the company's shared memory store. Uses semantic similarity (OpenAI embeddings) when available, falls back to keyword search. Returns team-wide knowledge ranked by relevance. Natural-language phrases work well.",
      z.object({
        q: z.string().trim().min(1).max(512),
        limit: z.number().int().positive().max(50).optional(),
        tags: z.array(z.string().trim().min(1).max(64)).max(8).optional(),
      }),
      async ({ q, limit, tags }) => {
        const companyId = client.resolveCompanyId();
        const params = new URLSearchParams();
        params.set("q", q);
        if (limit !== undefined) params.set("limit", String(limit));
        if (tags && tags.length > 0) params.set("tags", tags.join(","));
        return client.requestJson("GET", `/companies/${encodeURIComponent(companyId)}/memories/search?${params.toString()}`);
      },
    ),
    makeTool(
      "companyWikiUpsert",
      "Create or fully replace a named wiki page in the company knowledge base. Company wiki pages are injected into ALL agents at every wakeup — use for team-wide conventions, style guides, and architectural decisions. Content replaces the previous page entirely.",
      z.object({
        slug: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/, "slug must be lowercase alphanumeric with hyphens/underscores"),
        content: z.string().trim().min(1).max(4096),
        tags: z.array(z.string().trim().min(1).max(64)).max(16).optional(),
      }),
      async ({ slug, content, tags }) => {
        const companyId = client.resolveCompanyId();
        return client.requestJson("PUT", `/companies/${encodeURIComponent(companyId)}/memories/wiki/${encodeURIComponent(slug)}`, { body: { content, tags } });
      },
    ),
    makeTool(
      "companyWikiGet",
      "Read a named company wiki page by slug.",
      z.object({ slug: z.string().trim().min(1).max(64) }),
      async ({ slug }) => {
        const companyId = client.resolveCompanyId();
        return client.requestJson("GET", `/companies/${encodeURIComponent(companyId)}/memories/wiki/${encodeURIComponent(slug)}`);
      },
    ),
    makeTool(
      "companyWikiList",
      "List all company wiki pages (slugs + content). Use to see the team's shared knowledge base before reading or contributing.",
      z.object({}),
      async () => {
        const companyId = client.resolveCompanyId();
        return client.requestJson("GET", `/companies/${encodeURIComponent(companyId)}/memories/wiki`);
      },
    ),
    makeTool(
      "companyWikiDelete",
      "Delete a company wiki page by slug. Use when a team-wide knowledge page is outdated or superseded.",
      z.object({ slug: z.string().trim().min(1).max(64) }),
      async ({ slug }) => {
        const companyId = client.resolveCompanyId();
        return client.requestJson("DELETE", `/companies/${encodeURIComponent(companyId)}/memories/wiki/${encodeURIComponent(slug)}`);
      },
    ),
  ];
}
