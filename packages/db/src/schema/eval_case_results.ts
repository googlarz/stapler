import { pgTable, uuid, text, real, timestamp, index } from "drizzle-orm/pg-core";
import { evalRuns } from "./eval_runs.js";
import { evalCases } from "./eval_cases.js";

/**
 * Per-case result within an eval run.
 * Links back to the heartbeat run that produced the output being judged.
 * score is 0.0–1.0 (judge output normalized from 0–10).
 */
export const evalCaseResults = pgTable(
  "eval_case_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => evalRuns.id, { onDelete: "cascade" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => evalCases.id, { onDelete: "cascade" }),
    /**
     * FK to heartbeat_runs — loose reference, no FK constraint so pruning
     * heartbeat runs doesn't wipe eval history.
     */
    heartbeatRunId: uuid("heartbeat_run_id"),
    /** "pending" | "running" | "passed" | "failed" | "error" */
    status: text("status").notNull().default("pending"),
    /** 0.0–1.0 from LLM judge (raw 0–10 / 10). NULL until judged. */
    score: real("score"),
    /** LLM judge reasoning text. */
    judgeOutput: text("judge_output"),
    /** Captured stdout excerpt from the heartbeat run. */
    stdoutExcerpt: text("stdout_excerpt"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runIdx: index("eval_case_results_run_idx").on(table.runId),
    caseIdx: index("eval_case_results_case_idx").on(table.caseId),
  }),
);
