import { pgTable, uuid, text, real, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

/**
 * A named collection of test cases for evaluating an agent's performance.
 * Each suite belongs to a company and targets a specific agent.
 */
export const evalSuites = pgTable(
  "eval_suites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    /** Cron expression (UTC). When set, the scheduler triggers a run automatically. */
    scheduleExpression: text("schedule_expression"),
    /** 0.0–1.0. When a scheduled run's avgScore drops below this, an alert is logged. */
    alertThreshold: real("alert_threshold"),
    /** Timestamp of the last scheduler-triggered run (used to avoid double-firing). */
    lastScheduledRunAt: timestamp("last_scheduled_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("eval_suites_company_idx").on(table.companyId),
    agentIdx: index("eval_suites_agent_idx").on(table.agentId),
  }),
);
