export const type = "openai_compat";
export const label = "OpenAI-compatible (LiteLLM / vLLM)";

/** Default base URL for LiteLLM proxy (standard port). */
export const DEFAULT_OPENAI_COMPAT_BASE_URL = "http://localhost:4000";
export const DEFAULT_OPENAI_COMPAT_MODEL = "gpt-4o-mini";
export const DEFAULT_OPENAI_COMPAT_TIMEOUT_SEC = 600;
/** Maximum prior turn-pairs (user+assistant) kept in session history. */
export const DEFAULT_OPENAI_COMPAT_MAX_HISTORY_TURNS = 20;

export const models = [
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4.1", label: "GPT-4.1" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  { id: "claude-opus-4-5", label: "Claude Opus 4.5 (via proxy)" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (via proxy)" },
  { id: "gemini/gemini-2.5-pro", label: "Gemini 2.5 Pro (via LiteLLM)" },
];

export const agentConfigurationDoc = `# openai_compat agent configuration

Adapter: openai_compat

Use when:
- You are running a LiteLLM proxy or vLLM server that exposes an OpenAI-compatible API
- You want to access cloud LLMs (OpenAI, Anthropic, Gemini, Mistral, …) through a unified proxy
- You need Stapler's tool-calling loop against any model that supports function calling
- You want to load-balance or cost-track across multiple providers via LiteLLM
- You are running vLLM locally and need OpenAI-compatible access to open-source models

Don't use when:
- You are running Ollama locally without a proxy (use ollama_local instead)
- You want direct Claude Code / Codex agentic execution (use claude_local / codex_local)
- Your proxy does not support the OpenAI Chat Completions API (/v1/chat/completions)

Core fields:
- baseUrl (string, optional): OpenAI-compatible server base URL. Defaults to http://localhost:4000 (LiteLLM default).
- model (string, optional): Model name as understood by your proxy, e.g. "gpt-4o-mini", "claude-opus-4-5", "gemini/gemini-2.5-pro". Defaults to gpt-4o-mini.
- apiKey (string, optional): Bearer token / API key for the proxy. Leave empty for unauthenticated local servers.
- system (string, optional): System prompt override. Uses a sensible Stapler default when omitted.
- instructionsFilePath (string, optional): Path to an agent instructions file (AGENTS.md style).
- promptTemplate (string, optional): Mustache-style run prompt template.
- temperature (number, optional): Sampling temperature (0.0–2.0). Uses model default when omitted.

Operational fields:
- timeoutSec (number, optional): Run timeout in seconds. Defaults to 600. Set 0 for no timeout.
- maxHistoryTurns (number, optional): Prior conversation turns kept for context. Defaults to 20.
- enableTools (boolean, optional): Enable Stapler tool calling. Defaults to true.
- maxToolIterations (number, optional): Maximum tool-call iterations per run. Defaults to 10.
- llmConcurrency (number, optional): Max parallel requests to this endpoint. Defaults to 1.

Notes:
- The proxy must be reachable at baseUrl before the agent runs.
- Tool calling requires a model that supports the OpenAI tools API (most modern models via LiteLLM).
- Models that do not support tools automatically fall back to streaming text mode.
- Conversation history is stored in sessionParams and replayed across runs for context continuity.
`;
