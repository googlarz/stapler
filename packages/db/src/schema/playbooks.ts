/**
 * Playbooks — Pillar 8 of the Meta-Flywheel.
 *
 * Per-agent, per-task-pattern versioned strategies mined from high-scoring
 * runs. Auto-injected as context when a similar task arrives.
 */

import { pgTable, uuid, text, real, integer, timestamp, index } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";

export const playbooks = pgTable(
  "playbooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    /** Human-readable title derived from the clustered task pattern */
    title: text("title").notNull(),
    /** Normalised task pattern text for similarity matching */
    taskPatternNorm: text("task_pattern_norm").notNull(),
    /** JSON array of steps extracted from clustered runs */
    steps: text("steps").notNull(),
    /** Version counter — incremented each time the playbook is refined */
    version: integer("version").notNull().default(1),
    /** Win rate of runs that used this playbook (populated by A/B experiments) */
    winRate: real("win_rate"),
    /** Number of runs scored against this playbook */
    sampleSize: integer("sample_size").notNull().default(0),
    /** Whether this playbook is currently being A/B tested */
    abTesting: integer("ab_testing").notNull().default(0), // 0 = off, 1 = on
    /** Whether this playbook is active (not disabled by a human) */
    active: integer("active").notNull().default(1), // 0 = disabled, 1 = active
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    agentIdx: index("playbooks_agent_idx").on(table.agentId),
    companyIdx: index("playbooks_company_idx").on(table.companyId),
  }),
);
