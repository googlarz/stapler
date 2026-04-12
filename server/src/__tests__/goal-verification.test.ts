import { describe, expect, it } from "vitest";
import {
  buildVerificationIssueDescription,
  interpretOutcome,
  parseVerificationOutcome,
  VERIFICATION_FENCE_INFOSTRING,
  type LinkedIssueSnapshot,
} from "../lib/goal-verification-prompt.ts";
import { hasCompletedLinkedWorkForVerification as hasCompletedLinkedWorkForVerificationService } from "../services/goal-verification.ts";
import type { GoalAcceptanceCriterion } from "@paperclipai/shared";

const SAMPLE_CRITERIA: GoalAcceptanceCriterion[] = [
  { id: "c-1", text: "Landing page is live at example.com", required: true, order: 0 },
  { id: "c-2", text: "Analytics event fires on page load", required: true, order: 1 },
  { id: "c-3", text: "Press release is drafted", required: false, order: 2 },
];

const SAMPLE_ISSUES: LinkedIssueSnapshot[] = [
  {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Build landing page",
    description: "Spin up landing.example.com",
    recentComments: ["Deployed and verified by QA"],
    status: "done",
  },
];

describe("buildVerificationIssueDescription", () => {
  it("includes the goal title", () => {
    const out = buildVerificationIssueDescription({
      goalTitle: "Ship Q2 launch",
      goalDescription: null,
      criteria: SAMPLE_CRITERIA,
      linkedIssues: SAMPLE_ISSUES,
    });
    expect(out).toContain("Ship Q2 launch");
  });

  it("renders required vs optional tags for each criterion", () => {
    const out = buildVerificationIssueDescription({
      goalTitle: "x",
      goalDescription: null,
      criteria: SAMPLE_CRITERIA,
      linkedIssues: SAMPLE_ISSUES,
    });
    expect(out).toContain("[required]");
    expect(out).toContain("[optional]");
  });

  it("includes linked issues with their comments", () => {
    const out = buildVerificationIssueDescription({
      goalTitle: "x",
      goalDescription: null,
      criteria: SAMPLE_CRITERIA,
      linkedIssues: SAMPLE_ISSUES,
    });
    expect(out).toContain("ENG-1");
    expect(out).toContain("Deployed and verified by QA");
  });

  it("renders all recent comments in chronological order when multiple exist", () => {
    const issues: LinkedIssueSnapshot[] = [
      {
        id: "i-1",
        identifier: "ENG-2",
        title: "Implement feature",
        description: null,
        recentComments: ["Started work", "PR #10 merged", "Done ✓"],
        status: "done",
      },
    ];
    const out = buildVerificationIssueDescription({
      goalTitle: "x",
      goalDescription: null,
      criteria: SAMPLE_CRITERIA,
      linkedIssues: issues,
    });
    // All three comments must appear
    expect(out).toContain("Started work");
    expect(out).toContain("PR #10 merged");
    expect(out).toContain("Done ✓");
    // Chronological: first comment appears before last comment
    expect(out.indexOf("Started work")).toBeLessThan(out.indexOf("Done ✓"));
    // Last comment is labelled "final"
    expect(out).toMatch(/Comment \d+ \(final\)/);
  });

  it("shows '_(none)_' when an issue has no comments", () => {
    const issues: LinkedIssueSnapshot[] = [
      {
        id: "i-2",
        identifier: "ENG-3",
        title: "Silent task",
        description: null,
        recentComments: [],
        status: "done",
      },
    ];
    const out = buildVerificationIssueDescription({
      goalTitle: "x",
      goalDescription: null,
      criteria: SAMPLE_CRITERIA,
      linkedIssues: issues,
    });
    expect(out).toContain("_(none)_");
  });

  it("includes retry context block on attempt 2+", () => {
    const out = buildVerificationIssueDescription({
      goalTitle: "x",
      goalDescription: null,
      criteria: SAMPLE_CRITERIA,
      linkedIssues: SAMPLE_ISSUES,
      attemptNumber: 2,
    });
    expect(out).toContain("Retry context");
    expect(out).toContain("attempt **2**");
  });

  it("does NOT include retry context on attempt 1", () => {
    const out = buildVerificationIssueDescription({
      goalTitle: "x",
      goalDescription: null,
      criteria: SAMPLE_CRITERIA,
      linkedIssues: SAMPLE_ISSUES,
      attemptNumber: 1,
    });
    expect(out).not.toContain("Retry context");
  });

  it("does NOT include retry context when attemptNumber is omitted", () => {
    const out = buildVerificationIssueDescription({
      goalTitle: "x",
      goalDescription: null,
      criteria: SAMPLE_CRITERIA,
      linkedIssues: SAMPLE_ISSUES,
    });
    expect(out).not.toContain("Retry context");
  });

  it("includes the verification fence infostring in the example", () => {
    const out = buildVerificationIssueDescription({
      goalTitle: "x",
      goalDescription: null,
      criteria: SAMPLE_CRITERIA,
      linkedIssues: SAMPLE_ISSUES,
    });
    expect(out).toContain(VERIFICATION_FENCE_INFOSTRING);
  });

  it("handles goals with no linked issues", () => {
    const out = buildVerificationIssueDescription({
      goalTitle: "x",
      goalDescription: null,
      criteria: SAMPLE_CRITERIA,
      linkedIssues: [],
    });
    expect(out).toContain("no linked issues");
  });

  it("orders criteria by the order field", () => {
    const reordered: GoalAcceptanceCriterion[] = [
      { id: "c-b", text: "b criterion", required: true, order: 1 },
      { id: "c-a", text: "a criterion", required: true, order: 0 },
    ];
    const out = buildVerificationIssueDescription({
      goalTitle: "x",
      goalDescription: null,
      criteria: reordered,
      linkedIssues: [],
    });
    expect(out.indexOf("a criterion")).toBeLessThan(out.indexOf("b criterion"));
  });
});

describe("parseVerificationOutcome", () => {
  it("parses a well-formed fenced block", () => {
    const comment = [
      "Here's my judgement:",
      "",
      "```json verification_outcome",
      JSON.stringify({
        criteria: [
          { criterionId: "c-1", outcome: "pass", reason: "page is live" },
          { criterionId: "c-2", outcome: "unclear", reason: "could not verify" },
        ],
      }),
      "```",
    ].join("\n");

    const parsed = parseVerificationOutcome(comment);
    expect(parsed).not.toBeNull();
    expect(parsed!.criteria).toHaveLength(2);
    expect(parsed!.criteria[0].outcome).toBe("pass");
    expect(parsed!.criteria[1].outcome).toBe("unclear");
  });

  it("returns null when no fenced block is present", () => {
    expect(parseVerificationOutcome("no block here")).toBeNull();
  });

  it("ignores vanilla ```json blocks without the infostring", () => {
    const comment = [
      "```json",
      '{"foo": "bar"}',
      "```",
    ].join("\n");
    expect(parseVerificationOutcome(comment)).toBeNull();
  });

  it("returns null when the JSON is malformed", () => {
    const comment = [
      "```json verification_outcome",
      "{ not json at all",
      "```",
    ].join("\n");
    expect(parseVerificationOutcome(comment)).toBeNull();
  });

  it("returns null when criteria is missing", () => {
    const comment = [
      "```json verification_outcome",
      '{"foo": "bar"}',
      "```",
    ].join("\n");
    expect(parseVerificationOutcome(comment)).toBeNull();
  });

  it("returns null when a criterion has an unknown outcome value", () => {
    const comment = [
      "```json verification_outcome",
      JSON.stringify({
        criteria: [{ criterionId: "c-1", outcome: "maybe", reason: "..." }],
      }),
      "```",
    ].join("\n");
    expect(parseVerificationOutcome(comment)).toBeNull();
  });

  it("tolerates windows-style line endings", () => {
    const comment = [
      "```json verification_outcome",
      JSON.stringify({
        criteria: [{ criterionId: "c-1", outcome: "pass", reason: "ok" }],
      }),
      "```",
    ].join("\r\n");
    const parsed = parseVerificationOutcome(comment);
    expect(parsed).not.toBeNull();
    expect(parsed!.criteria).toHaveLength(1);
  });
});

describe("interpretOutcome", () => {
  it("returns passed when all required criteria are pass", () => {
    const result = interpretOutcome(SAMPLE_CRITERIA, {
      criteria: [
        { criterionId: "c-1", outcome: "pass", reason: "" },
        { criterionId: "c-2", outcome: "pass", reason: "" },
        { criterionId: "c-3", outcome: "fail", reason: "optional doesn't matter" },
      ],
    });
    expect(result.kind).toBe("passed");
  });

  it("returns failed when a required criterion fails", () => {
    const result = interpretOutcome(SAMPLE_CRITERIA, {
      criteria: [
        { criterionId: "c-1", outcome: "pass", reason: "" },
        { criterionId: "c-2", outcome: "fail", reason: "analytics broken" },
      ],
    });
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.failingCriteria).toHaveLength(1);
      expect(result.failingCriteria[0].criterionId).toBe("c-2");
    }
  });

  it("returns unclear when no failures but at least one required is unclear", () => {
    const result = interpretOutcome(SAMPLE_CRITERIA, {
      criteria: [
        { criterionId: "c-1", outcome: "pass", reason: "" },
        { criterionId: "c-2", outcome: "unclear", reason: "hard to tell" },
      ],
    });
    expect(result.kind).toBe("unclear");
  });

  it("returns incomplete when a required criterion is missing from the verdict", () => {
    const result = interpretOutcome(SAMPLE_CRITERIA, {
      criteria: [
        { criterionId: "c-1", outcome: "pass", reason: "" },
        // c-2 missing
      ],
    });
    expect(result.kind).toBe("incomplete");
    if (result.kind === "incomplete") {
      expect(result.missingCriterionIds).toEqual(["c-2"]);
    }
  });

  it("considers optional criteria irrelevant to the overall verdict", () => {
    const result = interpretOutcome(SAMPLE_CRITERIA, {
      criteria: [
        { criterionId: "c-1", outcome: "pass", reason: "" },
        { criterionId: "c-2", outcome: "pass", reason: "" },
        // c-3 (optional) missing entirely — still passes
      ],
    });
    expect(result.kind).toBe("passed");
  });

  it("handles goals with no required criteria (empty-pass edge case)", () => {
    const allOptional: GoalAcceptanceCriterion[] = [
      { id: "c-a", text: "a", required: false, order: 0 },
    ];
    const result = interpretOutcome(allOptional, { criteria: [] });
    expect(result.kind).toBe("passed");
  });
});

describe("hasCompletedLinkedWorkForVerification", () => {
  it("requires at least one non-cancelled linked issue", () => {
    expect(hasCompletedLinkedWorkForVerificationService([{ status: "cancelled" }])).toBe(false);
  });

  it("ignores cancelled issues when checking remaining linked work", () => {
    expect(hasCompletedLinkedWorkForVerificationService([
      { status: "done" },
      { status: "cancelled" },
    ])).toBe(true);
  });

  it("rejects any non-cancelled linked issue that is not done", () => {
    expect(hasCompletedLinkedWorkForVerificationService([
      { status: "done" },
      { status: "todo" },
      { status: "cancelled" },
    ])).toBe(false);
  });
});
