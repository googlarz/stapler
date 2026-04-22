import { pgTable, uuid, text, real, timestamp, index } from "drizzle-orm/pg-core";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { agents } from "./agents.js";
import { companies } from "./companies.js";

/**
 * Continuous-scoring record for a heartbeat run.
 *
 * Every successful heartbeat run (when `autoScoreRuns` is enabled on the
 * company/agent) is judged by the LLM judge against a generic or
 * criteria-derived rubric. The score is 0.0–1.0.
 *
 * One row per heartbeat run. Pillar 1 of the Quality Flywheel.
 */
export const runScores = pgTable(
  "run_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => heartbeatRuns.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** 0.0–1.0 */
    score: real("score").notNull(),
    /** Identifier for the rubric applied (e.g. "generic-v1", "issue-criteria-v1"). */
    rubricVersion: text("rubric_version").notNull().default("generic-v1"),
    /** Which rubric source was actually used. */
    rubricSource: text("rubric_source").notNull().default("generic"),
    /** Judge reasoning text. */
    reasoning: text("reasoning"),
    /** Model identifier that produced the judgment (e.g. "gpt-4o-mini", "llama3.2", "heuristic"). */
    judgeModel: text("judge_model"),
    judgedAt: timestamp("judged_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runIdx: index("run_scores_run_idx").on(table.runId),
    agentJudgedIdx: index("run_scores_agent_judged_idx").on(table.agentId, table.judgedAt),
    companyJudgedIdx: index("run_scores_company_judged_idx").on(table.companyId, table.judgedAt),
  }),
);
