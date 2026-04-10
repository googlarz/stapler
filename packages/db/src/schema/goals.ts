import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  jsonb,
  date,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";

/**
 * Structured acceptance criterion attached to a goal. Enables
 * "outcomes-based" goal definition where a goal declares what "done"
 * looks like as a checklist. Verification (pass/fail tracking against
 * linked issue deliverables) is a follow-up feature.
 */
export type GoalAcceptanceCriterion = {
  id: string;
  text: string;
  required: boolean;
  order: number;
};

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    title: text("title").notNull(),
    description: text("description"),
    level: text("level").notNull().default("task"),
    status: text("status").notNull().default("planned"),
    parentId: uuid("parent_id").references((): AnyPgColumn => goals.id),
    ownerAgentId: uuid("owner_agent_id").references(() => agents.id),
    acceptanceCriteria: jsonb("acceptance_criteria")
      .$type<GoalAcceptanceCriterion[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    targetDate: date("target_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("goals_company_idx").on(table.companyId),
  }),
);
