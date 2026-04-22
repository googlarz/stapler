/**
 * Delegation edges — Pillar 7 of the Meta-Flywheel.
 *
 * Records every agent-to-agent delegation: which agent delegated a task to
 * which other agent, what issue was created, how deep the chain is, and
 * what the eventual outcome was.
 *
 * Anti-patterns tracked:
 *   - ping-pong: A→B followed by B→A without meaningful progress
 *   - depth runaway: delegation chain depth > 4
 *   - orphan: no follow-up check_delegation call within N hours
 */

import { pgTable, uuid, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export const delegationEdges = pgTable(
  "delegation_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    /** The agent that delegated the task */
    fromAgentId: uuid("from_agent_id").notNull().references(() => agents.id),
    /** The agent that received the task */
    toAgentId: uuid("to_agent_id").notNull().references(() => agents.id),
    /** The issue created for this delegation */
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    /** Depth in the delegation chain (0 = top-level, 1 = delegated once, etc.) */
    depth: integer("depth").notNull().default(0),
    /** Final outcome: succeeded | failed | stalled | cancelled */
    outcome: text("outcome"),
    /** True if a ping-pong anti-pattern was detected on this edge */
    pingPongDetected: boolean("ping_pong_detected").notNull().default(false),
    /** True if a depth-runaway was detected (depth > 4) */
    depthRunawayDetected: boolean("depth_runaway_detected").notNull().default(false),
    /** Round-trip time in ms (from edge creation to outcome finalization) */
    roundTripMs: integer("round_trip_ms"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => ({
    companyIdx: index("delegation_edges_company_idx").on(table.companyId),
    fromAgentIdx: index("delegation_edges_from_agent_idx").on(table.fromAgentId),
    toAgentIdx: index("delegation_edges_to_agent_idx").on(table.toAgentId),
    issueIdx: index("delegation_edges_issue_idx").on(table.issueId),
  }),
);
