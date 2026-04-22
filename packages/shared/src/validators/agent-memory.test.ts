import { describe, it, expect } from "vitest";
import {
  agentMemoryTagsSchema,
  createAgentMemorySchema,
  listAgentMemoriesQuerySchema,
  MAX_AGENT_MEMORY_CONTENT_CHARS,
  MAX_AGENT_MEMORY_TAGS,
  MAX_AGENT_MEMORY_TAG_LENGTH,
} from "./agent-memory.js";

describe("agentMemoryTagsSchema", () => {
  it("accepts valid tags", () => {
    const result = agentMemoryTagsSchema.safeParse(["sprint", "backend", "issue:123"]);
    expect(result.success).toBe(true);
  });

  it("deduplicates tags", () => {
    const result = agentMemoryTagsSchema.safeParse(["sprint", "sprint", "backend"]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(["sprint", "backend"]);
    }
  });

  it("accepts tags with allowed special chars", () => {
    expect(agentMemoryTagsSchema.safeParse(["tag_1", "tag-2", "tag:3", "tag.4"]).success).toBe(true);
  });

  it("rejects empty tag", () => {
    expect(agentMemoryTagsSchema.safeParse([""]).success).toBe(false);
  });

  it("rejects tag with invalid characters", () => {
    expect(agentMemoryTagsSchema.safeParse(["tag with space"]).success).toBe(false);
    expect(agentMemoryTagsSchema.safeParse(["tag@invalid"]).success).toBe(false);
  });

  it(`rejects tag exceeding ${MAX_AGENT_MEMORY_TAG_LENGTH} characters`, () => {
    const longTag = "a".repeat(MAX_AGENT_MEMORY_TAG_LENGTH + 1);
    expect(agentMemoryTagsSchema.safeParse([longTag]).success).toBe(false);
  });

  it(`rejects more than ${MAX_AGENT_MEMORY_TAGS} tags`, () => {
    const tags = Array.from({ length: MAX_AGENT_MEMORY_TAGS + 1 }, (_, i) => `tag${i}`);
    expect(agentMemoryTagsSchema.safeParse(tags).success).toBe(false);
  });
});

describe("createAgentMemorySchema", () => {
  const validInput = { content: "Remember to check the PR" };

  it("accepts minimal valid input", () => {
    expect(createAgentMemorySchema.safeParse(validInput).success).toBe(true);
  });

  it("trims content whitespace", () => {
    const result = createAgentMemorySchema.safeParse({ content: "  hello  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toBe("hello");
    }
  });

  it("rejects empty content after trim", () => {
    expect(createAgentMemorySchema.safeParse({ content: "   " }).success).toBe(false);
  });

  it(`rejects content exceeding ${MAX_AGENT_MEMORY_CONTENT_CHARS} chars`, () => {
    const longContent = "a".repeat(MAX_AGENT_MEMORY_CONTENT_CHARS + 1);
    expect(createAgentMemorySchema.safeParse({ content: longContent }).success).toBe(false);
  });

  it("accepts content at exactly the max length", () => {
    const maxContent = "a".repeat(MAX_AGENT_MEMORY_CONTENT_CHARS);
    expect(createAgentMemorySchema.safeParse({ content: maxContent }).success).toBe(true);
  });

  it("accepts optional tags", () => {
    expect(createAgentMemorySchema.safeParse({ ...validInput, tags: ["sprint", "backend"] }).success).toBe(true);
  });

  it("accepts future expiresAt", () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
    expect(createAgentMemorySchema.safeParse({ ...validInput, expiresAt: future }).success).toBe(true);
  });

  it("rejects past expiresAt", () => {
    const past = "2020-01-01T00:00:00.000Z";
    expect(createAgentMemorySchema.safeParse({ ...validInput, expiresAt: past }).success).toBe(false);
  });

  it("rejects invalid datetime for expiresAt", () => {
    expect(createAgentMemorySchema.safeParse({ ...validInput, expiresAt: "not-a-date" }).success).toBe(false);
  });
});

describe("listAgentMemoriesQuerySchema", () => {
  it("accepts empty query", () => {
    expect(listAgentMemoriesQuerySchema.safeParse({}).success).toBe(true);
  });

  it("accepts valid search query", () => {
    expect(listAgentMemoriesQuerySchema.safeParse({ q: "sprint focus" }).success).toBe(true);
  });

  it("accepts limit and offset", () => {
    expect(listAgentMemoriesQuerySchema.safeParse({ limit: "50", offset: "100" }).success).toBe(true);
  });

  it("coerces string limit/offset to numbers", () => {
    const result = listAgentMemoriesQuerySchema.safeParse({ limit: "10", offset: "0" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(0);
    }
  });

  it("rejects limit > 100", () => {
    expect(listAgentMemoriesQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("rejects offset > 10000", () => {
    expect(listAgentMemoriesQuerySchema.safeParse({ offset: "10001" }).success).toBe(false);
  });

  it("parses comma-separated tags string", () => {
    const result = listAgentMemoriesQuerySchema.safeParse({ tags: "sprint,backend,issue:123" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual(["sprint", "backend", "issue:123"]);
    }
  });

  it("returns undefined for empty tags string", () => {
    const result = listAgentMemoriesQuerySchema.safeParse({ tags: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toBeUndefined();
    }
  });

  it("rejects extra fields (strict)", () => {
    expect(listAgentMemoriesQuerySchema.safeParse({ unknownField: "x" }).success).toBe(false);
  });
});
