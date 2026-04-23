import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

/**
 * A company output — a living document produced and maintained by agents.
 *
 * Outputs go through a simple lifecycle:
 *   pending_approval → active → (optionally) archived
 *
 * Any agent can propose an output. The proposal creates an approval issue
 * for the CEO. Once approved, agents collaborate on the shared draft and
 * release numbered versions (v1, v2, …). The draft is always open for
 * further improvement — nothing is ever locked.
 */
export const outputs = pgTable(
  "outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    /** pending_approval | active | archived */
    status: text("status").notNull().default("pending_approval"),
    /** Current working draft — agents edit this freely */
    draftContent: text("draft_content").notNull().default(""),
    proposedByAgentId: uuid("proposed_by_agent_id").references((): AnyPgColumn => agents.id, {
      onDelete: "set null",
    }),
    approvedByAgentId: uuid("approved_by_agent_id").references((): AnyPgColumn => agents.id, {
      onDelete: "set null",
    }),
    /** Issue created for the CEO to approve this output */
    approvalIssueId: uuid("approval_issue_id").references((): AnyPgColumn => issues.id, {
      onDelete: "set null",
    }),
    /** Latest released version number (0 = no version released yet) */
    latestVersionNumber: integer("latest_version_number").notNull().default(0),
    /** Timestamp of the most recent version release (null until first release) */
    latestVersionReleasedAt: timestamp("latest_version_released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("outputs_company_idx").on(table.companyId),
  }),
);

/**
 * Immutable version snapshots. Each time an agent releases a new version
 * the current draft is snapshotted here and `outputs.latest_version_number`
 * is incremented. Snapshots are never mutated or deleted.
 */
export const outputVersions = pgTable(
  "output_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outputId: uuid("output_id").notNull().references(() => outputs.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    content: text("content").notNull(),
    releasedByAgentId: uuid("released_by_agent_id").references((): AnyPgColumn => agents.id, {
      onDelete: "set null",
    }),
    releaseNotes: text("release_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    outputIdx: index("output_versions_output_idx").on(table.outputId),
  }),
);
