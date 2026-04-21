import { describe, expect, it } from "vitest";
import { isBedrockModelId } from "./models.js";

describe("isBedrockModelId", () => {
  it("detects region-qualified Bedrock model IDs", () => {
    expect(isBedrockModelId("us.anthropic.claude-sonnet-4-5-20250929-v2:0")).toBe(true);
    expect(isBedrockModelId("eu.anthropic.claude-haiku-3")).toBe(true);
    expect(isBedrockModelId("ap.anthropic.claude-opus-4")).toBe(true);
  });

  it("detects Bedrock ARN model IDs", () => {
    expect(
      isBedrockModelId("arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-v2"),
    ).toBe(true);
  });

  it("returns false for standard Anthropic API model IDs", () => {
    expect(isBedrockModelId("claude-3-opus-20240229")).toBe(false);
    expect(isBedrockModelId("claude-sonnet-4-5")).toBe(false);
    expect(isBedrockModelId("claude-haiku-3")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isBedrockModelId("")).toBe(false);
  });

  it("returns false for arbitrary strings", () => {
    expect(isBedrockModelId("gpt-4o")).toBe(false);
    expect(isBedrockModelId("llama3.2:3b")).toBe(false);
  });
});
