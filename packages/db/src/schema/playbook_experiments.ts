/**
 * Playbook experiments — Pillar 8 A/B testing.
 *
 * When a playbook has 2+ versions, an experiment can be created to route
 * 50/50 between them. The winner (higher win rate after N runs) is promoted.
 */

import { pgTable, uuid, text, real, integer, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { playbooks } from "./playbooks.js";

export const playbookExperiments = pgTable(
  "playbook_experiments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    controlPlaybookId: uuid("control_playbook_id").notNull().references(() => playbooks.id),
    challengerPlaybookId: uuid("challenger_playbook_id").notNull().references(() => playbooks.id),
    /** Status: running | control_won | challenger_won | inconclusive */
    status: text("status").notNull().default("running"),
    controlWins: integer("control_wins").notNull().default(0),
    challengerWins: integer("challenger_wins").notNull().default(0),
    totalRuns: integer("total_runs").notNull().default(0),
    /** Minimum runs before declaring a winner */
    minRuns: integer("min_runs").notNull().default(10),
    controlWinRate: real("control_win_rate"),
    challengerWinRate: real("challenger_win_rate"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    concludedAt: timestamp("concluded_at"),
  },
  (table) => ({
    companyIdx: index("playbook_experiments_company_idx").on(table.companyId),
  }),
);
