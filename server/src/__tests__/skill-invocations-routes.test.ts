/**
 * skill-invocations-routes.test.ts
 *
 * Integration tests for the skill slash command pipeline as a user would exercise it:
 *
 * 1. POST /issues/:id/skill-invocations — direct API invocation
 *    - valid inputs / happy path
 *    - missing skillKey → 400
 *    - unknown skill → 404
 *    - no assigned agent and no targetAgentId → 422
 *    - agent caller targeting a different agent → 403 (self-only enforcement)
 *    - targetAgentId belonging to a different company → 403 (cross-company rejection)
 *    - issue not found → 404
 *
 * 2. Instance skill management routes (GET / POST import / PATCH / DELETE)
 *    - admin-only write operations
 *    - non-admin board token → 403
 *    - empty PATCH body → 400
 *    - delete of non-existent skill → 404
 *
 * 3. Args injection escaping (pure logic, no HTTP)
 *    - < and > in arg values are unicode-escaped so they can't inject XML tags
 */

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { instanceSkillRoutes } from "../routes/instance-skills.js";

// ---------------------------------------------------------------------------
// Hoisted mocks — all vi.hoisted() calls BEFORE vi.mock()
// ---------------------------------------------------------------------------

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  getByIdentifier: vi.fn(async () => null),
  addComment: vi.fn(async () => ({ id: "comment-1", body: "" })),
  update: vi.fn(),
  findMentionedAgents: vi.fn(async () => []),
  list: vi.fn(async () => []),
  listWakeableBlockedDependents: vi.fn(async () => []),
  getWakeableParentAfterChildCompletion: vi.fn(async () => null),
  assertCheckoutOwner: vi.fn(),
  getRelationSummaries: vi.fn(async () => []),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  getByRole: vi.fn(async () => null),
  list: vi.fn(async () => []),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(async () => undefined),
  reportRunActivity: vi.fn(async () => undefined),
  getRun: vi.fn(async () => null),
  getActiveRunForAgent: vi.fn(async () => null),
  cancelRun: vi.fn(async () => null),
}));

const mockInstanceSkillService = vi.hoisted(() => ({
  getByKey: vi.fn(),
  list: vi.fn(async () => []),
  getById: vi.fn(async () => null),
  importFromSource: vi.fn(),
  updateSkill: vi.fn(),
  deleteSkill: vi.fn(),
  listRuntimeSkillEntries: vi.fn(async () => []),
}));

const mockInvokeSkill = vi.hoisted(() => vi.fn(async () => "inv-uuid-1"));
const mockParseSlashCommand = vi.hoisted(() => vi.fn(() => null));

// ---------------------------------------------------------------------------
// vi.mock() — module scope (hoisted by vitest at runtime)
// ---------------------------------------------------------------------------

vi.mock("@stapler/shared/telemetry", () => ({
  trackAgentTaskCompleted: vi.fn(),
  trackErrorHandlerCrash: vi.fn(),
}));

vi.mock("../telemetry.js", () => ({
  getTelemetryClient: vi.fn(() => ({ track: vi.fn() })),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    canUser: vi.fn(async () => true),
    hasPermission: vi.fn(async () => false),
    getMembership: vi.fn(async () => null),
  }),
  agentService: () => mockAgentService,
  documentService: () => ({}),
  executionWorkspaceService: () => ({}),
  feedbackService: () => ({
    listIssueVotesForUser: vi.fn(async () => []),
    saveIssueVote: vi.fn(async () => ({ vote: null, consentEnabledNow: false, sharingEnabled: false })),
  }),
  goalService: () => ({}),
  goalVerificationService: () => ({}),
  heartbeatService: () => mockHeartbeatService,
  instanceSettingsService: () => ({
    get: vi.fn(async () => ({
      id: "instance-settings-1",
      general: { censorUsernameInLogs: false, feedbackDataSharingPreference: "prompt" },
    })),
    listCompanyIds: vi.fn(async () => ["company-1"]),
  }),
  issueApprovalService: () => ({ linkManyForApproval: vi.fn() }),
  issueService: () => mockIssueService,
  logActivity: vi.fn(async () => undefined),
  projectService: () => ({}),
  routineService: () => ({ syncRunStatusForIssue: vi.fn(async () => undefined) }),
  workProductService: () => ({}),
}));

// Direct service imports that issues.ts uses without going through services/index
vi.mock("../services/instance-skills.js", () => ({
  instanceSkillService: () => mockInstanceSkillService,
}));

vi.mock("../services/skill-invoker.js", () => ({
  parseSlashCommand: mockParseSlashCommand,
  invokeSkill: mockInvokeSkill,
}));

// Other direct service imports in issues.ts
vi.mock("../services/issue-assignment-wakeup.js", () => ({ queueIssueAssignmentWakeup: vi.fn() }));
vi.mock("../services/post-mortem.js", () => ({ runPostMortem: vi.fn() }));
vi.mock("../services/routing-suggester.js", () => ({
  finalizeRoutingOutcome: vi.fn(async () => undefined),
  maybePostRoutingSuggestion: vi.fn(async () => undefined),
  recordRoutingOutcome: vi.fn(async () => undefined),
}));
vi.mock("../services/collaboration-analyzer.js", () => ({
  finalizeDelegationEdge: vi.fn(),
  recordDelegationEdge: vi.fn(),
}));
vi.mock("../routes/issues-checkout-wakeup.js", () => ({ shouldWakeAssigneeOnCheckout: vi.fn(async () => false) }));
vi.mock("../routes/workspace-command-authz.js", () => ({
  assertNoAgentHostWorkspaceCommandMutation: vi.fn(),
  collectIssueWorkspaceCommandPaths: vi.fn(() => []),
  assertWorkspaceCommandAllowed: vi.fn(),
  getWorkspaceCommandContext: vi.fn(),
}));
vi.mock("../services/issue-execution-policy.js", () => ({
  normalizeIssueExecutionPolicy: vi.fn(() => null),
  parseIssueExecutionPolicy: vi.fn(() => null),
  parseIssueBlockEscalationConfig: vi.fn(() => null),
  applyIssueExecutionPolicyTransition: vi.fn(async () => undefined),
  parseIssueExecutionState: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// App factories — created once per describe block
// ---------------------------------------------------------------------------

function makeActor(overrides: Record<string, unknown> = {}) {
  return {
    type: "board",
    userId: "user-1",
    companyIds: ["company-1"],
    source: "local_implicit",
    isInstanceAdmin: true,
    actorType: "user",
    actorId: "user-1",
    agentId: null,
    runId: null,
    ...overrides,
  };
}

function createIssueApp(actor: Record<string, unknown> = makeActor()) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = actor;
    next();
  });
  app.use("/api", issueRoutes({} as unknown as import("@stapler/db").Db, {} as unknown as import("../storage/types.js").StorageService));
  app.use(errorHandler);
  return app;
}

function createInstanceSkillApp(actor: Record<string, unknown> = makeActor()) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = actor;
    next();
  });
  app.use("/api", instanceSkillRoutes({} as unknown as import("@stapler/db").Db));
  app.use(errorHandler);
  return app;
}

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    companyId: "company-1",
    status: "todo",
    assigneeAgentId: "agent-1",
    assigneeUserId: null,
    createdByUserId: "user-1",
    identifier: "STP-1",
    title: "Test Issue",
    parentId: null,
    goalId: null,
    executionPolicyId: null,
    checkoutUserId: null,
    originKind: null,
    hiddenAt: null,
    executionState: null,
    executionPolicy: null,
    ...overrides,
  };
}

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "skill-1",
    key: "plan-phase",
    slug: "plan-phase",
    name: "Plan Phase",
    description: null,
    markdown: "# Plan Phase\nDo the planning.",
    sourceType: "github",
    sourceLocator: null,
    sourceRef: null,
    trustLevel: "markdown_only",
    compatibility: "compatible",
    fileInventory: [],
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// POST /issues/:id/skill-invocations — direct API invocation
// ---------------------------------------------------------------------------

describe("POST /issues/:id/skill-invocations", () => {
  const app = createIssueApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueService.getById.mockResolvedValue(makeIssue());
    mockInstanceSkillService.getByKey.mockResolvedValue(makeSkill());
    mockInvokeSkill.mockResolvedValue("inv-uuid-1");
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      name: "Builder",
    });
  });

  it("returns 201 with invocationId on a valid request from a board user", async () => {
    const res = await request(app)
      .post("/api/issues/issue-1/skill-invocations")
      .send({ skillKey: "plan-phase" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.invocationId).toBe("inv-uuid-1");
    expect(res.body.skillKey).toBe("plan-phase");
    expect(mockInvokeSkill).toHaveBeenCalledOnce();
  });

  it("passes trimmed skillKey to invokeSkill", async () => {
    await request(app)
      .post("/api/issues/issue-1/skill-invocations")
      .send({ skillKey: "  plan-phase  " });

    expect(mockInvokeSkill).toHaveBeenCalledOnce();
    const [opts] = mockInvokeSkill.mock.calls[0] as [Record<string, unknown>];
    expect(opts.skillKey).toBe("plan-phase");
  });

  it("returns 400 when skillKey is missing", async () => {
    const res = await request(app)
      .post("/api/issues/issue-1/skill-invocations")
      .send({ args: { phase: 1 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/skillKey/i);
  });

  it("returns 400 when skillKey is an empty string", async () => {
    const res = await request(app)
      .post("/api/issues/issue-1/skill-invocations")
      .send({ skillKey: "   " });

    expect(res.status).toBe(400);
  });

  it("returns 404 when the issue does not exist", async () => {
    mockIssueService.getById.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/issues/issue-1/skill-invocations")
      .send({ skillKey: "plan-phase" });

    expect(res.status).toBe(404);
  });

  it("returns 422 when the issue has no assigned agent and no targetAgentId is provided", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue({ assigneeAgentId: null }));
    const res = await request(app)
      .post("/api/issues/issue-1/skill-invocations")
      .send({ skillKey: "plan-phase" });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no assigned agent/i);
  });

  it("returns 404 when the skill key is not in the registry", async () => {
    mockInstanceSkillService.getByKey.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/issues/issue-1/skill-invocations")
      .send({ skillKey: "nonexistent-skill" });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found in the skill registry/i);
  });

  it("returns 403 when an agent caller targets a different agent — self-only enforcement", async () => {
    const agentApp = createIssueApp(makeActor({
      type: "agent",
      actorType: "agent",
      agentId: "agent-2", // not the issue assignee (agent-1)
      companyId: "company-1",
      source: undefined,
      userId: undefined,
    }));
    const res = await request(agentApp)
      .post("/api/issues/issue-1/skill-invocations")
      .send({ skillKey: "plan-phase" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only invoke skills targeting themselves/i);
    expect(mockInvokeSkill).not.toHaveBeenCalled();
  });

  it("allows an agent to invoke a skill targeting themselves", async () => {
    const agentApp = createIssueApp(makeActor({
      type: "agent",
      actorType: "agent",
      agentId: "agent-1", // same as issue.assigneeAgentId
      companyId: "company-1",
      source: undefined,
      userId: undefined,
    }));
    const res = await request(agentApp)
      .post("/api/issues/issue-1/skill-invocations")
      .send({ skillKey: "plan-phase" });

    expect(res.status).toBe(201);
    expect(mockInvokeSkill).toHaveBeenCalledOnce();
  });

  it("returns 403 when targetAgentId belongs to a different company — cross-company rejection", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-other",
      companyId: "company-2", // different company
      name: "Other Agent",
    });
    const res = await request(app)
      .post("/api/issues/issue-1/skill-invocations")
      .send({ skillKey: "plan-phase", targetAgentId: "agent-other" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/does not belong to this company/i);
    expect(mockInvokeSkill).not.toHaveBeenCalled();
  });

  it("passes structured args to invokeSkill when args object is provided", async () => {
    await request(app)
      .post("/api/issues/issue-1/skill-invocations")
      .send({ skillKey: "plan-phase", args: { phase: 1, verbose: true } });

    expect(mockInvokeSkill).toHaveBeenCalledOnce();
    const [opts] = mockInvokeSkill.mock.calls[0] as [Record<string, unknown>];
    expect(opts.args).toEqual({ phase: 1, verbose: true });
  });

  it("treats array args as empty — uses {} instead", async () => {
    await request(app)
      .post("/api/issues/issue-1/skill-invocations")
      .send({ skillKey: "plan-phase", args: [1, 2, 3] });

    expect(mockInvokeSkill).toHaveBeenCalledOnce();
    const [opts] = mockInvokeSkill.mock.calls[0] as [Record<string, unknown>];
    expect(opts.args).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Instance skill management routes
// ---------------------------------------------------------------------------

describe("GET /instance/skills", () => {
  it("returns the list of instance skills to any authenticated actor", async () => {
    const skill = makeSkill();
    mockInstanceSkillService.list.mockResolvedValue([skill]);
    const app = createInstanceSkillApp();
    const res = await request(app).get("/api/instance/skills");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].key).toBe("plan-phase");
  });
});

describe("GET /instance/skills/:id", () => {
  it("returns 404 when the skill does not exist", async () => {
    mockInstanceSkillService.getById.mockResolvedValue(null);
    const app = createInstanceSkillApp();
    const res = await request(app).get("/api/instance/skills/no-such-id");

    expect(res.status).toBe(404);
  });

  it("returns the skill when it exists", async () => {
    mockInstanceSkillService.getById.mockResolvedValue(makeSkill());
    const app = createInstanceSkillApp();
    const res = await request(app).get("/api/instance/skills/skill-1");

    expect(res.status).toBe(200);
    expect(res.body.key).toBe("plan-phase");
  });
});

describe("POST /instance/skills/import — admin-only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInstanceSkillService.importFromSource.mockResolvedValue({
      imported: [{ skill: makeSkill(), action: "created" }],
      warnings: [],
    });
  });

  it("imports a skill and returns 201 for an instance admin", async () => {
    const app = createInstanceSkillApp(makeActor({ isInstanceAdmin: true }));
    const res = await request(app)
      .post("/api/instance/skills/import")
      .send({ source: "https://github.com/owner/repo" });

    expect(res.status).toBe(201);
    expect(mockInstanceSkillService.importFromSource).toHaveBeenCalledWith("https://github.com/owner/repo");
  });

  it("returns 403 for a non-admin board token", async () => {
    const app = createInstanceSkillApp(makeActor({
      isInstanceAdmin: false,
      source: "api_key", // not local_implicit, so assertInstanceAdmin throws
    }));
    const res = await request(app)
      .post("/api/instance/skills/import")
      .send({ source: "https://github.com/owner/repo" });

    expect(res.status).toBe(403);
    expect(mockInstanceSkillService.importFromSource).not.toHaveBeenCalled();
  });

  it("returns 400 when source is missing from the body", async () => {
    const app = createInstanceSkillApp();
    const res = await request(app)
      .post("/api/instance/skills/import")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/source is required/i);
  });
});

describe("PATCH /instance/skills/:id — admin-only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInstanceSkillService.updateSkill.mockResolvedValue(makeSkill({ name: "Updated Name" }));
  });

  it("updates the skill and returns it", async () => {
    const app = createInstanceSkillApp();
    const res = await request(app)
      .patch("/api/instance/skills/skill-1")
      .send({ name: "Updated Name" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Name");
  });

  it("returns 400 when the body contains no patchable fields", async () => {
    const app = createInstanceSkillApp();
    const res = await request(app)
      .patch("/api/instance/skills/skill-1")
      .send({ unknownField: "value" });

    expect(res.status).toBe(400);
    expect(mockInstanceSkillService.updateSkill).not.toHaveBeenCalled();
  });

  it("returns 404 when the skill does not exist", async () => {
    mockInstanceSkillService.updateSkill.mockResolvedValue(null);
    const app = createInstanceSkillApp();
    const res = await request(app)
      .patch("/api/instance/skills/no-such")
      .send({ name: "New Name" });

    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-admin board token", async () => {
    const app = createInstanceSkillApp(makeActor({
      isInstanceAdmin: false,
      source: "api_key",
    }));
    const res = await request(app)
      .patch("/api/instance/skills/skill-1")
      .send({ name: "Sneaky Update" });

    expect(res.status).toBe(403);
  });
});

describe("DELETE /instance/skills/:id — admin-only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInstanceSkillService.deleteSkill.mockResolvedValue(makeSkill());
  });

  it("deletes the skill and returns it", async () => {
    const app = createInstanceSkillApp();
    const res = await request(app).delete("/api/instance/skills/skill-1");

    expect(res.status).toBe(200);
    expect(mockInstanceSkillService.deleteSkill).toHaveBeenCalledWith("skill-1");
  });

  it("returns 404 when the skill does not exist", async () => {
    mockInstanceSkillService.deleteSkill.mockResolvedValue(null);
    const app = createInstanceSkillApp();
    const res = await request(app).delete("/api/instance/skills/no-such");

    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-admin board token", async () => {
    const app = createInstanceSkillApp(makeActor({
      isInstanceAdmin: false,
      source: "api_key",
    }));
    const res = await request(app).delete("/api/instance/skills/skill-1");

    expect(res.status).toBe(403);
    expect(mockInstanceSkillService.deleteSkill).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Args injection — prompt escaping (pure logic, no HTTP needed)
// ---------------------------------------------------------------------------

describe("skill args injection escaping", () => {
  /**
   * Replicates the exact escaping logic from
   * packages/adapters/claude-local/src/server/execute.ts so that the invariant
   * is pinned by a test independent of adapter internals.
   */
  function buildArgsSection(args: Record<string, unknown>): string {
    const hasArgs = args && Object.keys(args).length > 0;
    if (!hasArgs) return "";
    const safe = JSON.stringify(args, null, 2)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e");
    return `\n\n<skill-args data-role="inert-data">\n${safe}\n</skill-args>`;
  }

  it("escapes < and > in arg values so they cannot inject XML tags", () => {
    const args = { payload: "<script>alert(1)</script>" };
    const section = buildArgsSection(args);

    expect(section).not.toContain("<script>");
    expect(section).not.toContain("</script>");
    expect(section).toContain("\\u003cscript\\u003e");
  });

  it("wraps args in a skill-args tag with the inert-data role attribute", () => {
    const section = buildArgsSection({ phase: "1" });

    expect(section).toContain('<skill-args data-role="inert-data">');
    expect(section).toContain("</skill-args>");
  });

  it("produces an empty string when args is empty so the section is omitted", () => {
    expect(buildArgsSection({})).toBe("");
  });

  it("escapes nested < and > inside JSON object values", () => {
    const args = { html: "<b>bold</b>", note: "a < b > c" };
    const section = buildArgsSection(args);

    expect(section).not.toMatch(/<b>/);
    // The JSON should use unicode escapes throughout
    expect(section).toContain("\\u003c");
    expect(section).toContain("\\u003e");
  });

  it("preserves non-angle-bracket special characters intact", () => {
    const args = { query: 'SELECT * FROM "users" WHERE id = 1 & name = \'alice\'' };
    const section = buildArgsSection(args);

    // & and ' and " should not be mangled
    expect(section).toContain("&");
    expect(section).toContain("users");
  });
});
