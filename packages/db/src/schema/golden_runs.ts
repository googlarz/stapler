import { pgTable, uuid, text, real, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

/**
 * Golden run registry — Pillar 4 of the Quality Flywheel.
 *
 * A golden run is a historical heartbeat run that has been hand-curated
 * as an exemplar. Golden runs can generate eval cases automatically
 * (replay their inputJson, judge with the same rubric) so that any
 * future config regression is caught before it ships.
 *
 * When a smoke suite is pinned to an agent, the config-gate service
 * runs all golden-run-derived eval cases against the *candidate* config
 * before applying the update.
 */
export const goldenRuns = pgTable(
  "golden_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    /** The original run that earned this golden status. */
    runId: uuid("run_id")
      .notNull()
      .references(() => heartbeatRuns.id, { onDelete: "cascade" }),
    /** Human-readable label for this exemplar. */
    label: text("label").notNull(),
    /**
     * Score recorded at the time this run was marked golden.
     * Used as the floor: future runs on the same eval case must not
     * drop more than `REGRESSION_TOLERANCE` below this.
     */
    frozenScore: real("frozen_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("golden_runs_company_idx").on(table.companyId),
    agentIdx: index("golden_runs_agent_idx").on(table.agentId),
    runIdx: index("golden_runs_run_idx").on(table.runId),
  }),
);
