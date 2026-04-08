import { describe, expect, it } from "vitest";
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_TIMEOUT_SEC,
} from "@paperclipai/adapter-ollama-local";
import { buildOllamaLocalConfig } from "@paperclipai/adapter-ollama-local/ui";

describe("buildOllamaLocalConfig", () => {
  it("uses Ollama-friendly defaults for create mode", () => {
    expect(buildOllamaLocalConfig({} as never)).toEqual({
      baseUrl: DEFAULT_OLLAMA_BASE_URL,
      model: DEFAULT_OLLAMA_MODEL,
      timeoutSec: DEFAULT_OLLAMA_TIMEOUT_SEC,
      graceSec: 15,
    });
  });

  it("preserves explicit config overrides", () => {
    expect(
      buildOllamaLocalConfig({
        model: "qwen3.5",
        promptTemplate: "Summarize {{agent.name}}",
        baseUrl: "http://ollama.internal:11434",
        system: "Be brief.",
        temperature: 0.2,
      } as never),
    ).toEqual({
      baseUrl: "http://ollama.internal:11434",
      model: "qwen3.5",
      promptTemplate: "Summarize {{agent.name}}",
      system: "Be brief.",
      temperature: 0.2,
      timeoutSec: DEFAULT_OLLAMA_TIMEOUT_SEC,
      graceSec: 15,
    });
  });
});
