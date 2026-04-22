/**
 * Routing outcomes — Pillar 6 of the Meta-Flywheel.
 *
 * Records the outcome of each issue assignment: which agent was assigned,
 * what the final run score was, and whether the issue was resolved.
 * Used by the routing-suggester to learn which agents succeed at which task types.
 */

import { pgTable, uuid, text, real, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export const routingOutcomes = pgTable(
  "routing_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    assignedAgentId: uuid("assigned_agent_id").notNull().references(() => agents.id),
    /** Normalised issue title — lower-cased, stripped of stop-words for lightweight similarity */
    issueTitleNorm: text("issue_title_norm"),
    /** Issue labels array as JSON (for label-match scoring) */
    issueLabels: text("issue_labels"),
    /** Average run score for runs on this issue (0–1) */
    runScore: real("run_score"),
    /** true when the issue reached status=done */
    resolved: boolean("resolved").notNull().default(false),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("routing_outcomes_company_idx").on(table.companyId),
    agentIdx: index("routing_outcomes_agent_idx").on(table.assignedAgentId),
    issueIdx: index("routing_outcomes_issue_idx").on(table.issueId),
  }),
);
