/**
 * Decomposition outcomes — Pillar 6 of the Meta-Flywheel.
 *
 * Records the outcome of each goal decomposition: which issues were created,
 * how many required rework, and what the final outcome score was.
 * Used for retrieval-augmented decomposition (RAG) so future similar goals
 * can learn from past successful decompositions.
 */

import { pgTable, uuid, text, real, integer, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { goals } from "./goals.js";

export const decompositionOutcomes = pgTable(
  "decomposition_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    goalId: uuid("goal_id").notNull().references(() => goals.id, { onDelete: "cascade" }),
    /** Normalised goal title for similarity matching */
    goalTitleNorm: text("goal_title_norm"),
    /** JSON array of issue titles that were generated */
    issueTitles: text("issue_titles").notNull(),
    /** Number of issues that required rework (re-opened after done) */
    reworkCount: integer("rework_count").notNull().default(0),
    /** Aggregate outcome score 0–1 (avg run_score of child issues, null until finalized) */
    outcomeScore: real("outcome_score"),
    /** null until the goal reaches achieved/failed */
    finalizedAt: timestamp("finalized_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("decomposition_outcomes_company_idx").on(table.companyId),
    goalIdx: index("decomposition_outcomes_goal_idx").on(table.goalId),
  }),
);
