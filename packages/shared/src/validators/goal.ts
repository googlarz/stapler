import { z } from "zod";
import { GOAL_LEVELS, GOAL_STATUSES, GOAL_VERIFICATION_STATUSES } from "../constants.js";

/** Guards against unbounded criteria lists that could bloat JSONB payloads. */
export const MAX_GOAL_ACCEPTANCE_CRITERIA = 50;

/**
 * A single acceptance criterion on a goal. `id` is client-generated
 * so criteria can be updated/reordered without race conditions.
 */
export const goalAcceptanceCriterionSchema = z.object({
  id: z.string().min(1).max(128),
  text: z.string().min(1).max(1000),
  required: z.boolean(),
  order: z.number().int().min(0),
});

export type GoalAcceptanceCriterionInput = z.infer<typeof goalAcceptanceCriterionSchema>;

/**
 * Validates a full acceptance criteria array:
 * - length cap (prevents unbounded JSONB growth)
 * - unique ids (guards against client bugs that would corrupt the checklist)
 * - unique order values (avoids flicker/ordering ambiguity in the UI)
 */
export const goalAcceptanceCriteriaArraySchema = z
  .array(goalAcceptanceCriterionSchema)
  .max(MAX_GOAL_ACCEPTANCE_CRITERIA, `At most ${MAX_GOAL_ACCEPTANCE_CRITERIA} criteria per goal`)
  .refine(
    (criteria) => new Set(criteria.map((c) => c.id)).size === criteria.length,
    { message: "Acceptance criteria ids must be unique" },
  )
  .refine(
    (criteria) => new Set(criteria.map((c) => c.order)).size === criteria.length,
    { message: "Acceptance criteria order values must be unique" },
  );

/**
 * ISO date (YYYY-MM-DD) that actually parses as a real calendar date.
 * The regex alone accepts `2026-13-45`; Date.parse catches those.
 */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "targetDate must be YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, { message: "targetDate must be a valid calendar date" });

export const createGoalSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  level: z.enum(GOAL_LEVELS).optional().default("task"),
  status: z.enum(GOAL_STATUSES).optional().default("planned"),
  parentId: z.string().uuid().optional().nullable(),
  ownerAgentId: z.string().uuid().optional().nullable(),
  acceptanceCriteria: goalAcceptanceCriteriaArraySchema.optional(),
  targetDate: isoDateSchema.optional().nullable(),
});

export type CreateGoal = z.infer<typeof createGoalSchema>;

export const updateGoalSchema = createGoalSchema.partial();

export type UpdateGoal = z.infer<typeof updateGoalSchema>;
