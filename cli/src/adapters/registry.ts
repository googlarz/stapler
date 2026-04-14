import type { CLIAdapterModule } from "@stapler/adapter-utils";
import { printClaudeStreamEvent } from "@stapler/adapter-claude-local/cli";
import { printCodexStreamEvent } from "@stapler/adapter-codex-local/cli";
import { printCursorStreamEvent } from "@stapler/adapter-cursor-local/cli";
import { printGeminiStreamEvent } from "@stapler/adapter-gemini-local/cli";
import { printOpenCodeStreamEvent } from "@stapler/adapter-opencode-local/cli";
import { printPiStreamEvent } from "@stapler/adapter-pi-local/cli";
import { printOpenClawGatewayStreamEvent } from "@stapler/adapter-openclaw-gateway/cli";
import { printOllamaStreamEvent } from "@stapler/adapter-ollama-local/cli";
import { processCLIAdapter } from "./process/index.js";
import { httpCLIAdapter } from "./http/index.js";

const claudeLocalCLIAdapter: CLIAdapterModule = {
  type: "claude_local",
  formatStdoutEvent: printClaudeStreamEvent,
};

const codexLocalCLIAdapter: CLIAdapterModule = {
  type: "codex_local",
  formatStdoutEvent: printCodexStreamEvent,
};

const openCodeLocalCLIAdapter: CLIAdapterModule = {
  type: "opencode_local",
  formatStdoutEvent: printOpenCodeStreamEvent,
};

const piLocalCLIAdapter: CLIAdapterModule = {
  type: "pi_local",
  formatStdoutEvent: printPiStreamEvent,
};

const cursorLocalCLIAdapter: CLIAdapterModule = {
  type: "cursor",
  formatStdoutEvent: printCursorStreamEvent,
};

const geminiLocalCLIAdapter: CLIAdapterModule = {
  type: "gemini_local",
  formatStdoutEvent: printGeminiStreamEvent,
};

const openclawGatewayCLIAdapter: CLIAdapterModule = {
  type: "openclaw_gateway",
  formatStdoutEvent: printOpenClawGatewayStreamEvent,
};

const ollamaLocalCLIAdapter: CLIAdapterModule = {
  type: "ollama_local",
  formatStdoutEvent: printOllamaStreamEvent,
};

const adaptersByType = new Map<string, CLIAdapterModule>(
  [
    claudeLocalCLIAdapter,
    codexLocalCLIAdapter,
    openCodeLocalCLIAdapter,
    piLocalCLIAdapter,
    cursorLocalCLIAdapter,
    geminiLocalCLIAdapter,
    openclawGatewayCLIAdapter,
    ollamaLocalCLIAdapter,
    processCLIAdapter,
    httpCLIAdapter,
  ].map((a) => [a.type, a]),
);

export function getCLIAdapter(type: string): CLIAdapterModule {
  return adaptersByType.get(type) ?? processCLIAdapter;
}
