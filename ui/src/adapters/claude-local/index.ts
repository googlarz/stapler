import type { UIAdapterModule } from "../types";
import { parseClaudeStdoutLine } from "@stapler/adapter-claude-local/ui";
import { ClaudeLocalConfigFields } from "./config-fields";
import { buildClaudeLocalConfig } from "@stapler/adapter-claude-local/ui";

export const claudeLocalUIAdapter: UIAdapterModule = {
  type: "claude_local",
  label: "Claude Code (local)",
  parseStdoutLine: parseClaudeStdoutLine,
  ConfigFields: ClaudeLocalConfigFields,
  buildAdapterConfig: buildClaudeLocalConfig,
};
