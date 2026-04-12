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
  /**
   * The last N comments on this issue, **in chronological order** (oldest
   * first). At most `MAX_COMMENTS_PER_ISSUE` entries are kept so the
   * verification prompt stays within a reasonable token budget.
   */
  recentComments: string[];
  status: string;
}

export interface VerificationPromptInput {
  goalTitle: string;
  goalDescription: string | null;
  criteria: GoalAcceptanceCriterion[];
  linkedIssues: LinkedIssueSnapshot[];
  /**
   * 1-based attempt counter. When > 1 a retry-context block is prepended
   * to the prompt so the verifying agent knows prior attempts did not
   * confirm achievement and should look for evidence of change.
   */
  attemptNumber?: number;
}

/**
 * Maximum number of comments to include per linked issue. Enough to capture
 * the work narrative (start → update → done) without blowing the token budget.
 */
export const MAX_COMMENTS_PER_ISSUE = 3;

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

      // Render comments in chronological order (oldest → newest) so the
      // verifying agent can follow the work narrative. We label the last
      // one "Final" so it stands out when scanning.
      const comments = issue.recentComments.filter((c) => c.trim().length > 0);
      let commentsBlock: string;
      if (comments.length === 0) {
        commentsBlock = "**Comments:** _(none)_";
      } else if (comments.length === 1) {
        commentsBlock = `**Final comment:**\n${comments[0].trim()}`;
      } else {
        const lines: string[] = [];
        for (let i = 0; i < comments.length; i++) {
          const label = i === comments.length - 1 ? `**Comment ${i + 1} (final):**` : `**Comment ${i + 1}:**`;
          lines.push(label, comments[i].trim());
          if (i < comments.length - 1) lines.push("");
        }
        commentsBlock = lines.join("\n");
      }

      return [
        `### ${id} — ${title} [${status}]`,
        "",
        `**Description:**`,
        desc,
        "",
        commentsBlock,
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

  // Retry context block — shown on attempts 2+ so the agent knows to look
  // for evidence of change rather than re-judging the same stale state.
  const retryBlock =
    input.attemptNumber && input.attemptNumber > 1
      ? [
          "> ⚠️ **Retry context:** This is verification attempt " +
            `**${input.attemptNumber}**. ` +
            "One or more previous attempts did not confirm the goal was achieved. " +
            "Look specifically for evidence that has changed or been added since the last evaluation — " +
            "new comments, updated descriptions, or completed work.",
          "",
        ]
      : [];

  // Use spread for conditional blocks so we never insert an empty-string
  // placeholder that would need to be filtered — filtering strips the
  // intentional blank-line spacers between sections.
  return [
    "# Goal verification",
    "",
    `You are verifying whether the goal **"${input.goalTitle}"** has been achieved.`,
    "",
    ...retryBlock,
    // Goal description is optional; if present, include it followed by a blank line.
    ...(input.goalDescription
      ? [`**Goal description:**\n${input.goalDescription.trim()}`, ""]
      : []),
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
  ].join("\n");
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
