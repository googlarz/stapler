import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agents,
  budgetIncidents,
  budgetPolicies,
  companies,
  companySkills,
  createDb,
  documents,
  documentRevisions,
  executionWorkspaces,
  issueDocuments,
  issueInboxArchives,
  issueLabels,
  issueReadStates,
  issues,
  labels,
  projectWorkspaces,
  projects,
  routineRuns,
  routines,
  routineTriggers,
  workspaceOperations,
  workspaceRuntimeServices,
} from "@stapler/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { companyService } from "../services/companies.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres company service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("companyService.remove", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof companyService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-companies-service-");
    db = createDb(tempDb.connectionString);
    svc = companyService(db);
  }, 20_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("deletes companies that have newer company-scoped child rows", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const projectId = randomUUID();
    const issueId = randomUUID();
    const workspaceId = randomUUID();
    const runtimeServiceId = randomUUID();
    const documentId = randomUUID();
    const budgetPolicyId = randomUUID();
    const routineId = randomUUID();
    const routineTriggerId = randomUUID();
    const labelId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CEO",
      role: "ceo",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "Roadmap",
      status: "active",
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Launch task",
      status: "todo",
      priority: "medium",
      createdByAgentId: agentId,
      assigneeAgentId: agentId,
      projectId,
    });

    await db.insert(projectWorkspaces).values({
      id: workspaceId,
      companyId,
      projectId,
      name: "Main workspace",
      sourceType: "local_path",
      cwd: "/tmp/paperclip-workspace",
    });

    await db.insert(executionWorkspaces).values({
      id: randomUUID(),
      companyId,
      projectId,
      projectWorkspaceId: workspaceId,
      mode: "task_branch",
      strategyType: "worktree",
      name: "Issue workspace",
      cwd: "/tmp/paperclip-exec",
      providerType: "local_fs",
    });

    await db.insert(workspaceRuntimeServices).values({
      id: runtimeServiceId,
      companyId,
      projectId,
      projectWorkspaceId: workspaceId,
      issueId,
      scopeType: "issue",
      scopeId: issueId,
      serviceName: "dev-server",
      status: "running",
      lifecycle: "ephemeral",
      provider: "process",
      lastUsedAt: new Date(),
      startedAt: new Date(),
      updatedAt: new Date(),
    });

    await db.insert(workspaceOperations).values({
      companyId,
      executionWorkspaceId: null,
      heartbeatRunId: null,
      phase: "workspace_provision",
      command: "git status",
      status: "failed",
      exitCode: 1,
    });

    await db.insert(documents).values({
      id: documentId,
      companyId,
      title: "Spec",
      latestBody: "# Spec",
      createdByAgentId: agentId,
      updatedByAgentId: agentId,
    });

    await db.insert(documentRevisions).values({
      companyId,
      documentId,
      revisionNumber: 1,
      body: "# Spec",
      createdByAgentId: agentId,
    });

    await db.insert(issueDocuments).values({
      companyId,
      issueId,
      documentId,
      key: "spec",
    });

    await db.insert(companySkills).values({
      companyId,
      key: `company/${companyId}/launch-skill`,
      slug: "launch-skill",
      name: "Launch Skill",
      markdown: "---\nname: Launch Skill\n---\n",
      sourceType: "local_path",
      sourceLocator: "/tmp/paperclip-skill",
      trustLevel: "markdown_only",
      compatibility: "compatible",
      fileInventory: [],
      updatedAt: new Date(),
    });

    await db.insert(labels).values({
      id: labelId,
      companyId,
      name: "launch",
      color: "#00aa00",
    });

    await db.insert(issueLabels).values({
      issueId,
      labelId,
      companyId,
    });

    await db.insert(issueReadStates).values({
      companyId,
      issueId,
      userId: "user-1",
    });

    await db.insert(issueInboxArchives).values({
      companyId,
      issueId,
      userId: "user-1",
    });

    await db.insert(budgetPolicies).values({
      id: budgetPolicyId,
      companyId,
      scopeType: "company",
      scopeId: companyId,
      metric: "billed_cents",
      windowKind: "monthly",
      amount: 1000,
    });

    await db.insert(budgetIncidents).values({
      companyId,
      policyId: budgetPolicyId,
      scopeType: "company",
      scopeId: companyId,
      metric: "billed_cents",
      windowKind: "monthly",
      windowStart: new Date("2026-01-01T00:00:00.000Z"),
      windowEnd: new Date("2026-02-01T00:00:00.000Z"),
      thresholdType: "hard_stop",
      amountLimit: 1000,
      amountObserved: 1200,
    });

    await db.insert(routines).values({
      id: routineId,
      companyId,
      projectId,
      title: "Daily sync",
      assigneeAgentId: agentId,
    });

    await db.insert(routineTriggers).values({
      id: routineTriggerId,
      companyId,
      routineId,
      kind: "schedule",
      enabled: true,
    });

    await db.insert(routineRuns).values({
      companyId,
      routineId,
      triggerId: routineTriggerId,
      source: "schedule",
    });

    const removed = await svc.remove(companyId);
    expect(removed?.id).toBe(companyId);

    const remainingCompany = await db.select().from(companies).where(eq(companies.id, companyId));
    const remainingSkills = await db.select().from(companySkills).where(eq(companySkills.companyId, companyId));
    const remainingDocs = await db.select().from(documents).where(eq(documents.companyId, companyId));
    const remainingPolicies = await db.select().from(budgetPolicies).where(eq(budgetPolicies.companyId, companyId));
    const remainingRoutines = await db.select().from(routines).where(eq(routines.companyId, companyId));

    expect(remainingCompany).toHaveLength(0);
    expect(remainingSkills).toHaveLength(0);
    expect(remainingDocs).toHaveLength(0);
    expect(remainingPolicies).toHaveLength(0);
    expect(remainingRoutines).toHaveLength(0);
  });
});
