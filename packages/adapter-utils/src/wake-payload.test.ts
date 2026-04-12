/**
 * Tests for the wake-payload normalisation pipeline.
 *
 * The wake payload is how Paperclip tells an agent *why* it was woken up and
 * what the current issue/comment context looks like.  It feeds directly into
 * the system prompt that reaches the model, so any silent data-loss here
 * produces a confused or unresponsive agent.
 *
 * Covers:
 *   normalizePaperclipWakePayload  — input sanitisation / null-guards
 *   stringifyPaperclipWakePayload  — round-trip serialisation
 *   renderPaperclipWakePrompt      — the human-readable block injected into
 *                                    the system prompt
 */

import { describe, expect, it } from "vitest";
import {
  normalizePaperclipWakePayload,
  renderPaperclipWakePrompt,
  stringifyPaperclipWakePayload,
} from "./server-utils.js";

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

const minimalIssue = {
  id: "issue-1",
  identifier: "GEM-1",
  title: "Hire a backend engineer",
  status: "todo",
  priority: "high",
};

const minimalComment = {
  id: "comment-1",
  issueId: "issue-1",
  body: "Please write a hiring plan.",
  bodyTruncated: false,
  createdAt: "2026-04-12T10:00:00Z",
  author: { type: "user", id: "user-42" },
};

// ---------------------------------------------------------------------------
// normalizePaperclipWakePayload — null / empty input guards
// ---------------------------------------------------------------------------

describe("normalizePaperclipWakePayload — null / empty guards", () => {
  it("returns null for null", () => {
    expect(normalizePaperclipWakePayload(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(normalizePaperclipWakePayload(undefined)).toBeNull();
  });

  it("returns null for a plain string", () => {
    expect(normalizePaperclipWakePayload("bad input")).toBeNull();
  });

  it("returns null for a number", () => {
    expect(normalizePaperclipWakePayload(42)).toBeNull();
  });

  it("returns null for an empty object (nothing meaningful present)", () => {
    expect(normalizePaperclipWakePayload({})).toBeNull();
  });

  it("returns null for an object with only unknown fields", () => {
    expect(normalizePaperclipWakePayload({ foo: "bar", baz: 1 })).toBeNull();
  });

  it("returns null when issue is present but has no id, identifier, or title", () => {
    expect(normalizePaperclipWakePayload({ issue: { status: "todo" } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizePaperclipWakePayload — issue field
// ---------------------------------------------------------------------------

describe("normalizePaperclipWakePayload — issue", () => {
  it("normalises a complete issue", () => {
    const result = normalizePaperclipWakePayload({ issue: minimalIssue });
    expect(result).not.toBeNull();
    expect(result!.issue).toEqual({
      id: "issue-1",
      identifier: "GEM-1",
      title: "Hire a backend engineer",
      status: "todo",
      priority: "high",
    });
  });

  it("returns non-null when only issue.id is present", () => {
    const result = normalizePaperclipWakePayload({ issue: { id: "x" } });
    expect(result).not.toBeNull();
    expect(result!.issue!.id).toBe("x");
    expect(result!.issue!.identifier).toBeNull();
    expect(result!.issue!.title).toBeNull();
  });

  it("returns non-null when only issue.identifier is present", () => {
    const result = normalizePaperclipWakePayload({ issue: { identifier: "GEM-2" } });
    expect(result?.issue?.identifier).toBe("GEM-2");
  });

  it("returns non-null when only issue.title is present", () => {
    const result = normalizePaperclipWakePayload({ issue: { title: "A title" } });
    expect(result?.issue?.title).toBe("A title");
  });

  it("trims whitespace from all issue string fields", () => {
    const result = normalizePaperclipWakePayload({
      issue: { id: "  x  ", identifier: "  GEM-3  ", title: "  Title  ", status: "  todo  ", priority: "  high  " },
    });
    expect(result!.issue).toEqual({
      id: "x",
      identifier: "GEM-3",
      title: "Title",
      status: "todo",
      priority: "high",
    });
  });

  it("sets issue fields to null when they are empty strings after trimming", () => {
    const result = normalizePaperclipWakePayload({
      issue: { id: "x", identifier: "   ", title: "" },
    });
    expect(result!.issue!.identifier).toBeNull();
    expect(result!.issue!.title).toBeNull();
  });

  it("sets issue to null when the issue value is not an object", () => {
    const result = normalizePaperclipWakePayload({ issue: "not-an-object", commentIds: ["c1"] });
    expect(result!.issue).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizePaperclipWakePayload — comments
// ---------------------------------------------------------------------------

describe("normalizePaperclipWakePayload — comments", () => {
  it("normalises a single valid comment", () => {
    const result = normalizePaperclipWakePayload({ comments: [minimalComment] });
    expect(result).not.toBeNull();
    expect(result!.comments).toHaveLength(1);
    const c = result!.comments[0]!;
    expect(c.id).toBe("comment-1");
    expect(c.body).toBe("Please write a hiring plan.");
    expect(c.bodyTruncated).toBe(false);
    expect(c.authorType).toBe("user");
    expect(c.authorId).toBe("user-42");
  });

  it("filters out comments with empty or missing body", () => {
    const result = normalizePaperclipWakePayload({
      comments: [
        { id: "c1", body: "" },        // empty body → filtered
        { id: "c2", body: "   " },     // whitespace-only body → filtered
        { id: "c3", body: "ok" },      // valid
        { id: "c4" },                  // missing body → filtered
      ],
    });
    expect(result!.comments).toHaveLength(1);
    expect(result!.comments[0]!.id).toBe("c3");
  });

  it("preserves bodyTruncated: true", () => {
    const result = normalizePaperclipWakePayload({
      comments: [{ ...minimalComment, bodyTruncated: true }],
    });
    expect(result!.comments[0]!.bodyTruncated).toBe(true);
  });

  it("defaults bodyTruncated to false when absent", () => {
    const { bodyTruncated: _, ...noTruncated } = minimalComment;
    const result = normalizePaperclipWakePayload({ comments: [noTruncated] });
    expect(result!.comments[0]!.bodyTruncated).toBe(false);
  });

  it("returns null when comments array is empty and no other content", () => {
    expect(normalizePaperclipWakePayload({ comments: [] })).toBeNull();
  });

  it("accepts a non-array comments field gracefully", () => {
    // non-array → treated as empty; falls through to other fields
    const result = normalizePaperclipWakePayload({ comments: "not-an-array", commentIds: ["c1"] });
    expect(result!.comments).toEqual([]);
  });

  it("sets includedCount to the number of valid comments when commentWindow is absent", () => {
    const result = normalizePaperclipWakePayload({
      comments: [minimalComment, { ...minimalComment, id: "c2" }],
    });
    expect(result!.includedCount).toBe(2);
    expect(result!.requestedCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// normalizePaperclipWakePayload — commentIds
// ---------------------------------------------------------------------------

describe("normalizePaperclipWakePayload — commentIds", () => {
  it("returns non-null when only commentIds is present", () => {
    const result = normalizePaperclipWakePayload({ commentIds: ["c1", "c2"] });
    expect(result).not.toBeNull();
    expect(result!.commentIds).toEqual(["c1", "c2"]);
  });

  it("filters empty/whitespace commentIds", () => {
    const result = normalizePaperclipWakePayload({
      commentIds: ["c1", "", "  ", "c2"],
    });
    expect(result!.commentIds).toEqual(["c1", "c2"]);
  });

  it("trims whitespace from commentIds", () => {
    const result = normalizePaperclipWakePayload({
      commentIds: ["  c1  ", "c2  "],
    });
    expect(result!.commentIds).toEqual(["c1", "c2"]);
  });

  it("filters non-string commentIds", () => {
    const result = normalizePaperclipWakePayload({
      commentIds: ["c1", 42 as unknown as string, null as unknown as string, "c2"],
    });
    expect(result!.commentIds).toEqual(["c1", "c2"]);
  });
});

// ---------------------------------------------------------------------------
// normalizePaperclipWakePayload — flags and counters
// ---------------------------------------------------------------------------

describe("normalizePaperclipWakePayload — flags and counters", () => {
  const basePayload = { issue: minimalIssue };

  it("defaults truncated to false", () => {
    expect(normalizePaperclipWakePayload(basePayload)!.truncated).toBe(false);
  });

  it("preserves truncated: true", () => {
    expect(normalizePaperclipWakePayload({ ...basePayload, truncated: true })!.truncated).toBe(true);
  });

  it("defaults fallbackFetchNeeded to false", () => {
    expect(normalizePaperclipWakePayload(basePayload)!.fallbackFetchNeeded).toBe(false);
  });

  it("preserves fallbackFetchNeeded: true", () => {
    const result = normalizePaperclipWakePayload({ ...basePayload, fallbackFetchNeeded: true });
    expect(result!.fallbackFetchNeeded).toBe(true);
  });

  it("preserves latestCommentId", () => {
    const result = normalizePaperclipWakePayload({ ...basePayload, latestCommentId: "cmt-99" });
    expect(result!.latestCommentId).toBe("cmt-99");
  });

  it("trims and nullifies empty latestCommentId", () => {
    const result = normalizePaperclipWakePayload({ ...basePayload, latestCommentId: "   " });
    expect(result!.latestCommentId).toBeNull();
  });

  it("reads commentWindow fields", () => {
    const result = normalizePaperclipWakePayload({
      ...basePayload,
      commentWindow: { requestedCount: 10, includedCount: 5, missingCount: 5 },
    });
    expect(result!.requestedCount).toBe(10);
    expect(result!.includedCount).toBe(5);
    expect(result!.missingCount).toBe(5);
  });

  it("defaults missingCount to 0 when absent", () => {
    expect(normalizePaperclipWakePayload(basePayload)!.missingCount).toBe(0);
  });

  it("preserves the reason field", () => {
    const result = normalizePaperclipWakePayload({ ...basePayload, reason: "comment" });
    expect(result!.reason).toBe("comment");
  });

  it("normalises reason to null when empty", () => {
    const result = normalizePaperclipWakePayload({ ...basePayload, reason: "  " });
    expect(result!.reason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizePaperclipWakePayload — executionStage
// ---------------------------------------------------------------------------

describe("normalizePaperclipWakePayload — executionStage", () => {
  it("returns non-null when executionStage has a wakeRole", () => {
    const result = normalizePaperclipWakePayload({
      executionStage: { wakeRole: "reviewer", stageId: "s1" },
    });
    expect(result).not.toBeNull();
    expect(result!.executionStage!.wakeRole).toBe("reviewer");
  });

  it("accepts reviewer / approver / executor wake roles", () => {
    for (const role of ["reviewer", "approver", "executor"]) {
      const r = normalizePaperclipWakePayload({ executionStage: { wakeRole: role } });
      expect(r!.executionStage!.wakeRole).toBe(role);
    }
  });

  it("sets wakeRole to null for unrecognised values", () => {
    const result = normalizePaperclipWakePayload({
      executionStage: { wakeRole: "manager", stageId: "s1" },
    });
    expect(result!.executionStage!.wakeRole).toBeNull();
  });

  it("normalises allowedActions — filters empty strings", () => {
    const result = normalizePaperclipWakePayload({
      executionStage: {
        wakeRole: "approver",
        allowedActions: ["approve", "", "  ", "reject"],
      },
    });
    expect(result!.executionStage!.allowedActions).toEqual(["approve", "reject"]);
  });

  it("normalises currentParticipant principal", () => {
    const result = normalizePaperclipWakePayload({
      executionStage: {
        wakeRole: "reviewer",
        currentParticipant: { type: "agent", agentId: "ag_01" },
      },
    });
    expect(result!.executionStage!.currentParticipant).toEqual({
      type: "agent",
      agentId: "ag_01",
      userId: null,
    });
  });

  it("sets currentParticipant to null for unknown principal type", () => {
    const result = normalizePaperclipWakePayload({
      executionStage: {
        wakeRole: "reviewer",
        currentParticipant: { type: "robot" },
      },
    });
    expect(result!.executionStage!.currentParticipant).toBeNull();
  });

  it("returns null executionStage for an empty executionStage object", () => {
    const result = normalizePaperclipWakePayload({
      issue: minimalIssue,
      executionStage: {},
    });
    expect(result!.executionStage).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// stringifyPaperclipWakePayload
// ---------------------------------------------------------------------------

describe("stringifyPaperclipWakePayload", () => {
  it("returns null for invalid input", () => {
    expect(stringifyPaperclipWakePayload(null)).toBeNull();
    expect(stringifyPaperclipWakePayload({})).toBeNull();
  });

  it("returns a JSON string for valid input", () => {
    const raw = { issue: minimalIssue };
    const result = stringifyPaperclipWakePayload(raw);
    expect(typeof result).toBe("string");
    const parsed = JSON.parse(result!);
    expect(parsed.issue.identifier).toBe("GEM-1");
  });

  it("round-trips through normalize → stringify → parse", () => {
    const raw = {
      issue: minimalIssue,
      comments: [minimalComment],
      reason: "comment",
      truncated: false,
      fallbackFetchNeeded: false,
    };
    const str = stringifyPaperclipWakePayload(raw)!;
    const parsed = JSON.parse(str);
    expect(parsed.issue.title).toBe("Hire a backend engineer");
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.reason).toBe("comment");
  });
});

// ---------------------------------------------------------------------------
// renderPaperclipWakePrompt
// ---------------------------------------------------------------------------

describe("renderPaperclipWakePrompt", () => {
  it("returns empty string for null input", () => {
    expect(renderPaperclipWakePrompt(null)).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(renderPaperclipWakePrompt({})).toBe("");
  });

  it("includes the standard header for a fresh wake", () => {
    const result = renderPaperclipWakePrompt({ issue: minimalIssue });
    expect(result).toContain("## Paperclip Wake Payload");
    expect(result).not.toContain("## Paperclip Resume Delta");
  });

  it("uses the resume header when resumedSession:true", () => {
    const result = renderPaperclipWakePrompt({ issue: minimalIssue }, { resumedSession: true });
    expect(result).toContain("## Paperclip Resume Delta");
    expect(result).not.toContain("## Paperclip Wake Payload");
  });

  it("includes the issue identifier and title", () => {
    const result = renderPaperclipWakePrompt({ issue: minimalIssue });
    expect(result).toContain("GEM-1");
    expect(result).toContain("Hire a backend engineer");
  });

  it("includes the reason", () => {
    const result = renderPaperclipWakePrompt({ issue: minimalIssue, reason: "issue_assigned" });
    expect(result).toContain("reason: issue_assigned");
  });

  it("includes issue status and priority when present", () => {
    const result = renderPaperclipWakePrompt({ issue: minimalIssue }); // status:todo, priority:high
    expect(result).toContain("issue status: todo");
    expect(result).toContain("issue priority: high");
  });

  it("omits issue status line when status is absent", () => {
    const issueNoStatus = { id: "x", identifier: "X-1", title: "Test" };
    const result = renderPaperclipWakePrompt({ issue: issueNoStatus });
    expect(result).not.toContain("issue status:");
  });

  it("includes fallback fetch needed line", () => {
    const result = renderPaperclipWakePrompt({ issue: minimalIssue, fallbackFetchNeeded: true });
    expect(result).toContain("fallback fetch needed: yes");
  });

  it("shows pending comments ratio", () => {
    const result = renderPaperclipWakePrompt({
      issue: minimalIssue,
      commentWindow: { requestedCount: 10, includedCount: 3, missingCount: 7 },
    });
    expect(result).toContain("pending comments: 3/10");
    expect(result).toContain("omitted comments: 7");
  });

  it("does not show omitted comments line when missingCount is 0", () => {
    const result = renderPaperclipWakePrompt({ issue: minimalIssue });
    expect(result).not.toContain("omitted comments");
  });

  it("includes comment bodies in the output", () => {
    const result = renderPaperclipWakePrompt({
      comments: [minimalComment],
    });
    expect(result).toContain("Please write a hiring plan.");
    expect(result).toContain("New comments in order:");
  });

  it("includes truncation notice when bodyTruncated is true", () => {
    const result = renderPaperclipWakePrompt({
      comments: [{ ...minimalComment, bodyTruncated: true }],
    });
    expect(result).toContain("[comment body truncated]");
  });

  it("does not show truncation notice for non-truncated comments", () => {
    const result = renderPaperclipWakePrompt({
      comments: [{ ...minimalComment, bodyTruncated: false }],
    });
    expect(result).not.toContain("[comment body truncated]");
  });

  it("includes reviewer guidance when wakeRole is reviewer", () => {
    const result = renderPaperclipWakePrompt({
      issue: minimalIssue,
      executionStage: {
        wakeRole: "reviewer",
        stageId: "s1",
        allowedActions: ["approve", "request_changes"],
      },
    });
    expect(result).toContain("execution wake role: reviewer");
    expect(result).toContain("allowed actions: approve, request_changes");
    expect(result).toContain("You are waking as the active reviewer");
    expect(result).toContain("Do not execute the task itself");
  });

  it("includes approver guidance when wakeRole is approver", () => {
    const result = renderPaperclipWakePrompt({
      issue: minimalIssue,
      executionStage: { wakeRole: "approver", stageId: "s1" },
    });
    expect(result).toContain("You are waking as the active approver");
  });

  it("includes executor guidance when wakeRole is executor", () => {
    const result = renderPaperclipWakePrompt({
      issue: minimalIssue,
      executionStage: { wakeRole: "executor", stageId: "s1" },
    });
    expect(result).toContain("You are waking because changes were requested");
  });

  it("includes author info in comment lines", () => {
    const result = renderPaperclipWakePrompt({ comments: [minimalComment] });
    expect(result).toContain("user user-42");
  });

  it("labels unknown author type gracefully", () => {
    const commentNoAuthor = { id: "c1", body: "hi", author: {} };
    const result = renderPaperclipWakePrompt({ comments: [commentNoAuthor] });
    expect(result).toContain("comment c1");
    expect(result).toContain("hi");
  });

  it("numbers multiple comments sequentially", () => {
    const result = renderPaperclipWakePrompt({
      comments: [
        { ...minimalComment, body: "first" },
        { ...minimalComment, id: "c2", body: "second" },
      ],
    });
    expect(result).toContain("1. comment");
    expect(result).toContain("2. comment");
    expect(result).toContain("first");
    expect(result).toContain("second");
  });
});
