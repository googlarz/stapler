import type { UIAdapterModule } from "../types";
import { parseOllamaStdoutLine } from "@stapler/adapter-ollama-local/ui";
import { buildOllamaLocalConfig } from "@stapler/adapter-ollama-local/ui";
import { OllamaLocalConfigFields } from "./config-fields";

export const ollamaLocalUIAdapter: UIAdapterModule = {
  type: "ollama_local",
  label: "Ollama (local)",
  parseStdoutLine: parseOllamaStdoutLine,
  ConfigFields: OllamaLocalConfigFields,
  buildAdapterConfig: buildOllamaLocalConfig,
};
