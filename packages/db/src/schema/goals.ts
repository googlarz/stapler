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
  integer,
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
    /**
     * Verification state. See `server/src/services/goal-verification.ts`.
     * not_started  → never tried
     * pending      → verification issue is open and assigned to the owner agent
     * passed       → criteria judged passed; goal.status should be "achieved"
     * failed       → criteria judged failed; a follow-up issue was created
     */
    verificationStatus: text("verification_status").notNull().default("not_started"),
    verificationAttempts: integer("verification_attempts").notNull().default(0),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /**
     * Loose reference — no FK constraint, since `issues.goalId` already
     * references `goals.id` and we avoid a circular FK at the schema level.
     * The issues service clears this column when the referenced issue is
     * deleted.
     */
    verificationIssueId: uuid("verification_issue_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("goals_company_idx").on(table.companyId),
  }),
);
