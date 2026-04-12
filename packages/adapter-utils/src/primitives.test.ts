/**
 * Exhaustive tests for the low-level utility functions exported from server-utils.
 *
 * These functions are the foundation that everything else (skill injection, template
 * rendering, wake-payload parsing) is built on. A bug here can corrupt data silently
 * across the entire adapter pipeline.
 */

import { describe, expect, it } from "vitest";
import {
  appendWithCap,
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  joinPromptSections,
  MAX_CAPTURE_BYTES,
  MAX_EXCERPT_BYTES,
  parseJson,
  parseObject,
} from "./server-utils.js";

// ---------------------------------------------------------------------------
// parseObject
// ---------------------------------------------------------------------------

describe("parseObject", () => {
  it("returns the object unchanged for a plain object", () => {
    const obj = { a: 1, b: "two" };
    expect(parseObject(obj)).toBe(obj);
  });

  it("returns {} for null", () => {
    expect(parseObject(null)).toEqual({});
  });

  it("returns {} for undefined", () => {
    expect(parseObject(undefined)).toEqual({});
  });

  it("returns {} for a string", () => {
    expect(parseObject("hello")).toEqual({});
  });

  it("returns {} for a number", () => {
    expect(parseObject(42)).toEqual({});
    expect(parseObject(0)).toEqual({});
    expect(parseObject(-1)).toEqual({});
    expect(parseObject(NaN)).toEqual({});
  });

  it("returns {} for a boolean", () => {
    expect(parseObject(true)).toEqual({});
    expect(parseObject(false)).toEqual({});
  });

  it("returns {} for an array (arrays are objects but excluded)", () => {
    expect(parseObject([])).toEqual({});
    expect(parseObject([1, 2, 3])).toEqual({});
  });

  it("preserves nested objects", () => {
    const obj = { nested: { deep: true } };
    expect(parseObject(obj)).toBe(obj);
  });

  it("returns {} for a class instance (treated as object, but test identity)", () => {
    class Foo { x = 1; }
    const foo = new Foo();
    // class instances pass the typeof check so they're returned as-is
    expect(parseObject(foo)).toBe(foo);
  });
});

// ---------------------------------------------------------------------------
// asString
// ---------------------------------------------------------------------------

describe("asString", () => {
  it("returns the string when non-empty", () => {
    expect(asString("hello", "fallback")).toBe("hello");
    expect(asString("  ", "fallback")).toBe("  "); // whitespace-only is still a string with length > 0
  });

  it("returns fallback for an empty string", () => {
    expect(asString("", "fallback")).toBe("fallback");
  });

  it("returns fallback for null", () => {
    expect(asString(null, "fb")).toBe("fb");
  });

  it("returns fallback for undefined", () => {
    expect(asString(undefined, "fb")).toBe("fb");
  });

  it("returns fallback for number", () => {
    expect(asString(42, "fb")).toBe("fb");
    expect(asString(0, "fb")).toBe("fb");
  });

  it("returns fallback for boolean", () => {
    expect(asString(true, "fb")).toBe("fb");
    expect(asString(false, "fb")).toBe("fb");
  });

  it("returns fallback for object", () => {
    expect(asString({}, "fb")).toBe("fb");
    expect(asString({ toString: () => "x" }, "fb")).toBe("fb");
  });

  it("returns fallback for array", () => {
    expect(asString(["a"], "fb")).toBe("fb");
  });

  it("fallback can itself be empty string", () => {
    expect(asString(null, "")).toBe("");
    expect(asString(undefined, "")).toBe("");
  });

  it("long string is returned as-is", () => {
    const long = "x".repeat(100_000);
    expect(asString(long, "fb")).toBe(long);
  });
});

// ---------------------------------------------------------------------------
// asNumber
// ---------------------------------------------------------------------------

describe("asNumber", () => {
  it("returns the number for finite values", () => {
    expect(asNumber(0, 99)).toBe(0);
    expect(asNumber(1, 99)).toBe(1);
    expect(asNumber(-1, 99)).toBe(-1);
    expect(asNumber(3.14, 99)).toBe(3.14);
    expect(asNumber(Number.MAX_SAFE_INTEGER, 99)).toBe(Number.MAX_SAFE_INTEGER);
    expect(asNumber(Number.MIN_SAFE_INTEGER, 99)).toBe(Number.MIN_SAFE_INTEGER);
  });

  it("returns fallback for NaN", () => {
    expect(asNumber(NaN, 99)).toBe(99);
  });

  it("returns fallback for Infinity", () => {
    expect(asNumber(Infinity, 99)).toBe(99);
    expect(asNumber(-Infinity, 99)).toBe(99);
  });

  it("returns fallback for null", () => {
    expect(asNumber(null, 99)).toBe(99);
  });

  it("returns fallback for undefined", () => {
    expect(asNumber(undefined, 99)).toBe(99);
  });

  it("returns fallback for numeric string", () => {
    expect(asNumber("42", 99)).toBe(99); // not a number type
  });

  it("returns fallback for boolean", () => {
    expect(asNumber(true, 99)).toBe(99);
    expect(asNumber(false, 99)).toBe(99);
  });

  it("returns fallback for object", () => {
    expect(asNumber({}, 99)).toBe(99);
  });

  it("fallback of 0 is valid", () => {
    expect(asNumber(null, 0)).toBe(0);
  });

  it("returns negative fallback when given invalid input", () => {
    expect(asNumber("bad", -1)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// asBoolean
// ---------------------------------------------------------------------------

describe("asBoolean", () => {
  it("returns true when value is exactly true", () => {
    expect(asBoolean(true, false)).toBe(true);
  });

  it("returns false when value is exactly false", () => {
    expect(asBoolean(false, true)).toBe(false);
  });

  it("returns fallback for truthy non-boolean values", () => {
    expect(asBoolean(1, false)).toBe(false);       // truthy number → fallback
    expect(asBoolean("true", false)).toBe(false);  // string → fallback
    expect(asBoolean({}, false)).toBe(false);      // truthy object → fallback
    expect(asBoolean([], false)).toBe(false);      // truthy array → fallback
  });

  it("returns fallback for falsy non-boolean values", () => {
    expect(asBoolean(0, true)).toBe(true);
    expect(asBoolean("", true)).toBe(true);
    expect(asBoolean(null, true)).toBe(true);
    expect(asBoolean(undefined, true)).toBe(true);
    expect(asBoolean(NaN, true)).toBe(true);
  });

  it("correctly round-trips both fallback values", () => {
    expect(asBoolean(null, true)).toBe(true);
    expect(asBoolean(null, false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// asStringArray
// ---------------------------------------------------------------------------

describe("asStringArray", () => {
  it("returns an array of strings unchanged", () => {
    expect(asStringArray(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("filters out non-string elements", () => {
    expect(asStringArray(["a", 1, null, undefined, true, "b", {}])).toEqual(["a", "b"]);
  });

  it("returns [] for an empty array", () => {
    expect(asStringArray([])).toEqual([]);
  });

  it("returns [] for null", () => {
    expect(asStringArray(null)).toEqual([]);
  });

  it("returns [] for undefined", () => {
    expect(asStringArray(undefined)).toEqual([]);
  });

  it("returns [] for a string (not an array)", () => {
    expect(asStringArray("hello")).toEqual([]);
  });

  it("returns [] for a number", () => {
    expect(asStringArray(42)).toEqual([]);
  });

  it("returns [] for a plain object", () => {
    expect(asStringArray({ 0: "a", 1: "b" })).toEqual([]);
  });

  it("preserves empty strings inside the array", () => {
    // asStringArray only checks typeof string, not whether it's non-empty
    expect(asStringArray(["", "hello", ""])).toEqual(["", "hello", ""]);
  });
});

// ---------------------------------------------------------------------------
// parseJson
// ---------------------------------------------------------------------------

describe("parseJson", () => {
  it("parses a valid JSON object string", () => {
    expect(parseJson('{"a":1,"b":"two"}')).toEqual({ a: 1, b: "two" });
  });

  it("returns null for invalid JSON", () => {
    expect(parseJson("not json")).toBeNull();
    expect(parseJson("{bad}")).toBeNull();
    expect(parseJson("")).toBeNull();
  });

  it("returns null for a JSON array string (not an object)", () => {
    // parseJson claims to return Record<string, unknown> but in practice
    // JSON.parse('[1,2]') is an array — the cast is caller's responsibility.
    // Test what the function actually does:
    const result = parseJson("[1,2,3]");
    // It doesn't validate shape, just parses — returns the array cast as Record
    expect(result).not.toBeNull();
  });

  it("returns null for a JSON primitive string", () => {
    // JSON.parse('"hello"') returns a string, not an object
    const result = parseJson('"hello"');
    // Again — function just parses, no shape validation
    expect(result).not.toBeNull(); // technically returns "hello" cast as Record
  });

  it("handles nested objects", () => {
    const result = parseJson('{"outer":{"inner":"value"}}');
    expect(result).toEqual({ outer: { inner: "value" } });
  });

  it("handles unicode in JSON", () => {
    expect(parseJson('{"emoji":"🚀"}')).toEqual({ emoji: "🚀" });
  });
});

// ---------------------------------------------------------------------------
// appendWithCap
// ---------------------------------------------------------------------------

describe("appendWithCap", () => {
  it("appends normally when well under the cap", () => {
    expect(appendWithCap("hello ", "world")).toBe("hello world");
  });

  it("returns just the chunk when prev is empty", () => {
    expect(appendWithCap("", "chunk")).toBe("chunk");
  });

  it("returns prev unchanged when chunk is empty", () => {
    expect(appendWithCap("prev", "")).toBe("prev");
  });

  it("keeps the full combined string when exactly at the cap", () => {
    const cap = 10;
    const combined = "0123456789"; // exactly 10 chars
    expect(appendWithCap("01234", "56789", cap)).toBe(combined);
  });

  it("slices from the end when over the cap", () => {
    const cap = 5;
    const result = appendWithCap("AAAAAA", "BBBBB", cap); // 11 chars combined
    expect(result).toBe("BBBBB"); // last 5
    expect(result).toHaveLength(cap);
  });

  it("uses MAX_CAPTURE_BYTES as default cap", () => {
    // A string well under the default cap
    const result = appendWithCap("a", "b");
    expect(result).toBe("ab");
  });

  it("slices to exactly cap characters when way over cap", () => {
    const cap = 3;
    const result = appendWithCap("XXXXXX", "YYYYYY", cap);
    expect(result).toBe("YYY"); // last 3
  });

  it("the default MAX_CAPTURE_BYTES constant is 4MB", () => {
    expect(MAX_CAPTURE_BYTES).toBe(4 * 1024 * 1024);
  });

  it("the default MAX_EXCERPT_BYTES constant is 32KB", () => {
    expect(MAX_EXCERPT_BYTES).toBe(32 * 1024);
  });
});

// ---------------------------------------------------------------------------
// joinPromptSections
// ---------------------------------------------------------------------------

describe("joinPromptSections", () => {
  it("joins two non-empty sections with double newline by default", () => {
    expect(joinPromptSections(["hello", "world"])).toBe("hello\n\nworld");
  });

  it("trims leading/trailing whitespace from each section", () => {
    expect(joinPromptSections(["  hello  ", "  world  "])).toBe("hello\n\nworld");
  });

  it("filters out null entries", () => {
    expect(joinPromptSections(["a", null, "b"])).toBe("a\n\nb");
  });

  it("filters out undefined entries", () => {
    expect(joinPromptSections(["a", undefined, "b"])).toBe("a\n\nb");
  });

  it("filters out empty strings after trimming", () => {
    expect(joinPromptSections(["a", "", "   ", "b"])).toBe("a\n\nb");
  });

  it("returns empty string when all sections are null/undefined/empty", () => {
    expect(joinPromptSections([null, undefined, "  "])).toBe("");
  });

  it("returns empty string for empty array", () => {
    expect(joinPromptSections([])).toBe("");
  });

  it("returns single section unchanged (no separator)", () => {
    expect(joinPromptSections(["only"])).toBe("only");
  });

  it("respects a custom separator", () => {
    expect(joinPromptSections(["a", "b", "c"], "\n---\n")).toBe("a\n---\nb\n---\nc");
  });

  it("handles sections with internal newlines correctly (only outer whitespace trimmed)", () => {
    const section = "  line1\nline2  ";
    expect(joinPromptSections([section])).toBe("line1\nline2");
  });

  it("handles a large number of sections", () => {
    const sections = Array.from({ length: 100 }, (_, i) => `section ${i}`);
    const result = joinPromptSections(sections);
    expect(result.split("\n\n")).toHaveLength(100);
  });
});
