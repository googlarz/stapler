/**
 * Goal decomposition service.
 *
 * Given a goal (title + description + acceptance criteria), calls an LLM to
 * generate a concrete list of implementation tasks, then creates them as
 * Stapler issues linked to the goal.
 *
 * Provider selection mirrors eval-judge.ts / memory-extractor.ts:
 *   OpenAI (gpt-4o-mini) → Ollama → deterministic fallback (one issue per criterion)
 */

import type { Db } from "@stapler/db";
import type { GoalAcceptanceCriterion } from "@stapler/db";
import { goalService } from "./goals.js";
import { issueService } from "./issues.js";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OLLAMA_HOST = "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL = "llama3.2";

function buildDecomposePrompt(
  title: string,
  description: string | null,
  criteria: GoalAcceptanceCriterion[],
  maxIssues: number,
): string {
  const criteriaText =
    criteria.length > 0
      ? criteria.map((c, i) => `  ${i + 1}. ${c.text}`).join("\n")
      : "  (none specified)";

  return `You are a software project manager. Decompose the following goal into ${maxIssues} or fewer concrete, actionable implementation tasks.

GOAL: ${title}
DESCRIPTION: ${description ?? "(none)"}
ACCEPTANCE CRITERIA:
${criteriaText}

Rules:
- Each task must be a single concrete action (e.g. "Implement X", "Write tests for Y", "Configure Z").
- Tasks should together cover all acceptance criteria.
- Keep titles under 100 characters.
- Return ONLY valid JSON — no prose, no markdown.

Format: {"tasks": ["task title 1", "task title 2", ...]}`;
}

async function decomposeWithOpenAI(
  title: string,
  description: string | null,
  criteria: GoalAcceptanceCriterion[],
  maxIssues: number,
): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: buildDecomposePrompt(title, description, criteria, maxIssues) }],
        temperature: 0.3,
        max_tokens: 512,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data?.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(content) as { tasks?: unknown };
    if (!Array.isArray(parsed.tasks)) return [];
    return (parsed.tasks as unknown[])
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .slice(0, maxIssues);
  } catch {
    return [];
  }
}

async function decomposeWithOllama(
  title: string,
  description: string | null,
  criteria: GoalAcceptanceCriterion[],
  maxIssues: number,
): Promise<string[]> {
  const host = process.env.STAPLER_OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST;
  const model = process.env.STAPLER_OLLAMA_JUDGE_MODEL ?? DEFAULT_OLLAMA_MODEL;

  try {
    const res = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: buildDecomposePrompt(title, description, criteria, maxIssues) }],
        stream: false,
        options: { temperature: 0.3 },
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { message?: { content?: string } };
    const content = data?.message?.content?.trim() ?? "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as { tasks?: unknown };
    if (!Array.isArray(parsed.tasks)) return [];
    return (parsed.tasks as unknown[])
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .slice(0, maxIssues);
  } catch {
    return [];
  }
}

/** Fallback: one issue per acceptance criterion, or a single generic task. */
function decomposeHeuristic(
  title: string,
  criteria: GoalAcceptanceCriterion[],
  maxIssues: number,
): string[] {
  if (criteria.length > 0) {
    return criteria
      .slice(0, maxIssues)
      .map((c) => `Implement: ${c.text.slice(0, 90)}`);
  }
  return [`Implement: ${title.slice(0, 90)}`];
}

export interface DecomposeGoalResult {
  goalId: string;
  goalTitle: string;
  issues: Array<{ id: string; title: string; identifier: string | null }>;
}

/**
 * Decompose a goal into issues.
 *
 * @param db        Database connection
 * @param goalId    Goal to decompose
 * @param companyId Company (for authz + issue creation)
 * @param assigneeAgentId  Agent to assign the new issues to (optional)
 * @param maxIssues Max issues to create (default 5, capped at 10)
 */
export async function decomposeGoal(
  db: Db,
  goalId: string,
  companyId: string,
  assigneeAgentId: string | null,
  maxIssues: number = 5,
): Promise<DecomposeGoalResult> {
  const capped = Math.max(1, Math.min(10, maxIssues));

  const goal = await goalService(db).getById(goalId);
  if (!goal || goal.companyId !== companyId) {
    throw new Error("Goal not found");
  }

  const criteria = Array.isArray(goal.acceptanceCriteria) ? goal.acceptanceCriteria : [];

  // Generate task titles via LLM (cascade: OpenAI → Ollama → heuristic)
  let taskTitles = await decomposeWithOpenAI(goal.title, goal.description, criteria, capped);
  if (taskTitles.length === 0) {
    taskTitles = await decomposeWithOllama(goal.title, goal.description, criteria, capped);
  }
  if (taskTitles.length === 0) {
    taskTitles = decomposeHeuristic(goal.title, criteria, capped);
  }

  const issueSvc = issueService(db);
  const created: Array<{ id: string; title: string; identifier: string | null }> = [];

  for (const title of taskTitles) {
    const issue = await issueSvc.create(companyId, {
      title,
      goalId,
      ...(assigneeAgentId != null ? { assigneeAgentId } : {}),
      originKind: "agent_decompose",
    });
    if (issue) {
      created.push({ id: issue.id, title: issue.title, identifier: issue.identifier ?? null });
    }
  }

  return { goalId, goalTitle: goal.title, issues: created };
}
