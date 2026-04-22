import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { evalSuites } from "./eval_suites.js";

/**
 * A single execution of an eval suite — runs all cases and scores each.
 * summary_json is populated once all cases finish:
 *   { passed: N, failed: N, errors: N, avgScore: 0.0–1.0 }
 */
export const evalRuns = pgTable(
  "eval_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    suiteId: uuid("suite_id")
      .notNull()
      .references(() => evalSuites.id, { onDelete: "cascade" }),
    triggeredBy: text("triggered_by").notNull().default("api"),
    /** "pending" | "running" | "done" | "failed" */
    status: text("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    summaryJson: jsonb("summary_json").$type<{
      passed: number;
      failed: number;
      errors: number;
      avgScore: number;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    suiteIdx: index("eval_runs_suite_idx").on(table.suiteId),
    statusIdx: index("eval_runs_status_idx").on(table.status),
  }),
);
