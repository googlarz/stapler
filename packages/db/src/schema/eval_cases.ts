import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { evalSuites } from "./eval_suites.js";

/**
 * A single test case within an eval suite.
 * Contains the input context passed to the agent at wakeup, plus
 * natural-language scoring criteria for the LLM judge.
 */
export const evalCases = pgTable(
  "eval_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    suiteId: uuid("suite_id")
      .notNull()
      .references(() => evalSuites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Wakeup context passed to the agent: { task, wakeReason, ... } */
    inputJson: jsonb("input_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    /** Natural-language criteria describing what a passing response looks like. */
    criteria: text("criteria").notNull(),
    /** Optional memory tags to verify appeared in the run's injected context. */
    expectedTags: jsonb("expected_tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    suiteIdx: index("eval_cases_suite_idx").on(table.suiteId),
  }),
);
