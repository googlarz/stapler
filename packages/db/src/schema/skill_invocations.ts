import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { agents } from "./agents.js";
import { issueComments } from "./issue_comments.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

/**
 * Tracks every skill invocation triggered by a slash command in an issue thread
 * (or by the `stapler_invoke_skill` MCP tool).
 *
 * Lifecycle: pending → running → succeeded | failed | cancelled
 */
export const skillInvocations = pgTable(
  "skill_invocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    /** Slash-command / skill identifier, e.g. "plan-phase" or "gsd:debug". */
    skillKey: text("skill_key").notNull(),
    /** Optional JSON args parsed from the command line after the skill name. */
    args: jsonb("args").$type<Record<string, unknown>>(),
    /**
     * Lifecycle status.
     * pending   — invocation row created, agent not yet woken
     * running   — heartbeat run started executing the skill
     * succeeded — run finished; result_comment_id is set
     * failed    — run errored; error_message is set
     * cancelled — invocation aborted before execution
     */
    status: text("status").notNull().default("pending"),
    /** The comment that triggered this invocation (body contained the slash command). */
    triggerCommentId: uuid("trigger_comment_id").references(() => issueComments.id, {
      onDelete: "set null",
    }),
    /** The heartbeat run that executed (or is executing) this skill. */
    heartbeatRunId: uuid("heartbeat_run_id").references(() => heartbeatRuns.id, {
      onDelete: "set null",
    }),
    /** The agent's final comment that contains the skill result. */
    resultCommentId: uuid("result_comment_id").references(() => issueComments.id, {
      onDelete: "set null",
    }),
    /** Error message when status = "failed". */
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    issueIdx: index("skill_invocations_issue_idx").on(table.issueId),
    companyIdx: index("skill_invocations_company_idx").on(table.companyId),
    agentIdx: index("skill_invocations_agent_idx").on(table.agentId),
    statusIdx: index("skill_invocations_status_idx").on(table.status),
    runIdx: index("skill_invocations_run_idx").on(table.heartbeatRunId),
  }),
);
