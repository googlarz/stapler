import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/db",
      "packages/adapter-utils",
      "packages/adapters/claude-local",
      "packages/adapters/codex-local",
      "packages/adapters/gemini-local",
      "packages/adapters/ollama-local",
      "packages/adapters/opencode-local",
      "packages/plugins/slack-sync",
      "server",
      "ui",
      "cli",
    ],
  },
});
