import type { GoalAcceptanceCriterion } from "@paperclipai/shared";

/**
 * Goal verification — prompt template and comment parser.
 *
 * This module contains NO database or network code. It is pure:
 * - build a verification prompt from a goal + its acceptance criteria
 *   and the linked issues' deliverables
 * - parse a verification outcome back out of an agent's comment
 *
 * The rest of the verification flow (creating the verification issue,
 * assigning the owner agent, applying the outcome to the goal) lives
 * in `goalService` so it can run inside a transaction.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CriterionOutcome = "pass" | "fail" | "unclear";

export interface CriterionVerdict {
  criterionId: string;
  outcome: CriterionOutcome;
  reason: string;
}

export interface VerificationOutcome {
  criteria: CriterionVerdict[];
}

export interface LinkedIssueSnapshot {
  id: string;
  identifier: string | null;
  title: string;
  description: string | null;
  finalComment: string | null;
  status: string;
}

export interface VerificationPromptInput {
  goalTitle: string;
  goalDescription: string | null;
  criteria: GoalAcceptanceCriterion[];
  linkedIssues: LinkedIssueSnapshot[];
}

// ---------------------------------------------------------------------------
// Prompt template
// ---------------------------------------------------------------------------

/**
 * Fenced code block infostring used to mark the verification outcome JSON.
 * Non-standard (it includes a second word) so it does not collide with a
 * normal `json` block the agent might paste while reasoning.
 */
export const VERIFICATION_FENCE_INFOSTRING = "json verification_outcome";

/**
 * Build the description for a verification issue. Rendered once at issue
 * creation time — we snapshot the criteria and deliverables so later edits
 * to the goal or the linked issues don't change what the agent was asked
 * to judge.
 */
export function buildVerificationIssueDescription(input: VerificationPromptInput): string {
  const criteriaLines = input.criteria
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((c, i) => {
      const req = c.required ? "required" : "optional";
      return `${i + 1}. **[${req}]** \`${c.id}\` — ${c.text}`;
    })
    .join("\n");

  const issuesLines = input.linkedIssues
    .map((issue) => {
      const id = issue.identifier ?? issue.id;
      const title = issue.title;
      const status = issue.status;
      const desc = issue.description?.trim() || "_(no description)_";
      const final = issue.finalComment?.trim() || "_(no closing comment)_";
      return [
        `### ${id} — ${title} [${status}]`,
        "",
        `**Description:**`,
        desc,
        "",
        `**Final comment:**`,
        final,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  const criterionExampleList = input.criteria
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((c) =>
      `    { "criterionId": ${JSON.stringify(c.id)}, "outcome": "pass", "reason": "..." }`,
    )
    .join(",\n");

  return [
    "# Goal verification",
    "",
    `You are verifying whether the goal **"${input.goalTitle}"** has been achieved.`,
    "",
    input.goalDescription
      ? `**Goal description:**\n${input.goalDescription.trim()}\n`
      : "",
    "## Acceptance criteria",
    "",
    "Judge each criterion independently against the linked issues below. A criterion passes if the deliverables clearly demonstrate that it was met. If you can't tell, mark it `unclear` — don't guess.",
    "",
    criteriaLines || "_(no criteria)_",
    "",
    "## Linked issues (all marked done)",
    "",
    issuesLines || "_(no linked issues)_",
    "",
    "## Output format",
    "",
    "When you finish judging, post a single comment on THIS issue containing a fenced code block with the infostring `json verification_outcome`, followed by the verdict JSON. Example:",
    "",
    "````",
    "```" + VERIFICATION_FENCE_INFOSTRING,
    "{",
    '  "criteria": [',
    criterionExampleList || '    { "criterionId": "c-1", "outcome": "pass", "reason": "..." }',
    "  ]",
    "}",
    "```",
    "````",
    "",
    "Use `pass`, `fail`, or `unclear` for each outcome. Include a one-sentence reason. Do not include any other JSON blocks in your comment — we parse the first block with this infostring.",
    "",
    "After posting the comment, mark this issue `done`.",
  ].filter((line) => line !== "").join("\n");
}

// ---------------------------------------------------------------------------
// Comment parser
// ---------------------------------------------------------------------------

/**
 * Pull the first fenced code block with the `json verification_outcome`
 * infostring out of an agent's comment. Return the parsed outcome or null
 * if no block was found or the JSON was malformed.
 */
export function parseVerificationOutcome(commentBody: string): VerificationOutcome | null {
  if (!commentBody) return null;
  // Match ```json verification_outcome\n{...}\n```
  // Tolerates extra whitespace in the infostring, optional trailing
  // newline before the closing fence, and closing fence at EOF.
  const fence = /```json\s+verification_outcome\s*\r?\n([\s\S]*?)\r?\n?```/i;
  const match = commentBody.match(fence);
  if (!match) return null;

  const raw = match[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.criteria)) return null;

  const criteria: CriterionVerdict[] = [];
  for (const entry of obj.criteria) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const rec = entry as Record<string, unknown>;
    const criterionId = typeof rec.criterionId === "string" ? rec.criterionId : null;
    const outcome =
      rec.outcome === "pass" || rec.outcome === "fail" || rec.outcome === "unclear"
        ? rec.outcome
        : null;
    const reason = typeof rec.reason === "string" ? rec.reason : "";
    if (!criterionId || !outcome) return null;
    criteria.push({ criterionId, outcome, reason });
  }

  return { criteria };
}

// ---------------------------------------------------------------------------
// Outcome interpretation
// ---------------------------------------------------------------------------

export type OutcomeVerdict =
  | { kind: "passed" }
  | { kind: "failed"; failingCriteria: CriterionVerdict[] }
  | { kind: "unclear"; unclearCriteria: CriterionVerdict[] }
  | { kind: "incomplete"; missingCriterionIds: string[] };

/**
 * Interpret a parsed outcome against the goal's current criteria.
 * - passed: all REQUIRED criteria are `pass`. Optional criteria may be unclear/fail.
 * - failed: any required criterion is `fail`.
 * - unclear: no required criterion failed, but at least one required is `unclear`.
 * - incomplete: the agent missed one or more required criteria in its verdict.
 */
export function interpretOutcome(
  criteria: GoalAcceptanceCriterion[],
  outcome: VerificationOutcome,
): OutcomeVerdict {
  const verdictById = new Map(outcome.criteria.map((v) => [v.criterionId, v]));
  const required = criteria.filter((c) => c.required);

  const missing = required
    .filter((c) => !verdictById.has(c.id))
    .map((c) => c.id);
  if (missing.length > 0) return { kind: "incomplete", missingCriterionIds: missing };

  const failing = required
    .map((c) => verdictById.get(c.id)!)
    .filter((v) => v.outcome === "fail");
  if (failing.length > 0) return { kind: "failed", failingCriteria: failing };

  const unclear = required
    .map((c) => verdictById.get(c.id)!)
    .filter((v) => v.outcome === "unclear");
  if (unclear.length > 0) return { kind: "unclear", unclearCriteria: unclear };

  return { kind: "passed" };
}
