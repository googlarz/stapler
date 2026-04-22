import { z } from "zod";

export const createEvalSuiteSchema = z.object({
  agentId: z.string().uuid("agentId must be a UUID"),
  name: z.string().trim().min(1, "name is required").max(255),
  description: z.string().trim().max(2000).optional(),
  /** Standard 5-field cron expression (UTC). Omit to disable scheduling. */
  scheduleExpression: z.string().trim().max(100).optional(),
  /** 0.0–1.0. Alert when a scheduled run's avgScore drops below this. */
  alertThreshold: z.number().min(0).max(1).optional(),
});

export const updateEvalSuiteSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  scheduleExpression: z.string().trim().max(100).nullable().optional(),
  alertThreshold: z.number().min(0).max(1).nullable().optional(),
});

export const createEvalCaseSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(255),
  /**
   * Wakeup context to pass to the agent. At minimum include a `task`
   * or `wakeReason` string so the agent knows what to do.
   */
  inputJson: z.record(z.unknown()).default({}),
  criteria: z.string().trim().min(1, "criteria is required").max(4000),
  expectedTags: z.array(z.string().trim().min(1)).max(20).default([]),
});

export const triggerEvalRunSchema = z.object({
  triggeredBy: z.string().trim().max(128).optional(),
});

export type CreateEvalSuite = z.infer<typeof createEvalSuiteSchema>;
export type UpdateEvalSuite = z.infer<typeof updateEvalSuiteSchema>;
export type CreateEvalCase = z.infer<typeof createEvalCaseSchema>;
export type TriggerEvalRun = z.infer<typeof triggerEvalRunSchema>;
