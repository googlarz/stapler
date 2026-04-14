import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  asNumber,
  asString,
  asBoolean,
  buildPaperclipEnv,
  parseObject,
  renderTemplate,
  readPaperclipRuntimeSkillEntries,
  readPaperclipSkillMarkdown,
} from "@paperclipai/adapter-utils/server-utils";
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MAX_HISTORY_TURNS, DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_TIMEOUT_SEC } from "../index.js";
import { resolveOllamaDesiredSkillNames } from "./skills.js";
import {
  PAPERCLIP_TOOLS,
  buildPaperclipApiContext,
  executePaperclipTool,
  type OllamaToolCall,
} from "./tools.js";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaChunkLine {
  type: "chunk";
  content: string;
}

export interface OllamaDoneLine {
  type: "done";
  model: string;
  prompt_eval_count: number;
  eval_count: number;
  total_duration_ns: number;
}

export interface OllamaErrorLine {
  type: "error";
  message: string;
}

export type OllamaStdoutLine = OllamaChunkLine | OllamaDoneLine | OllamaErrorLine;

const DEFAULT_SYSTEM_PROMPT = `\
You are an AI agent running inside Paperclip — an autonomous agent management platform.

## How you operate
- You run in **single-turn mode**: you receive one message and produce one response. There are no follow-up turns.
- Your response is posted as a **comment on your assigned issue**. That comment is your deliverable for this run.
- You cannot call external APIs, run shell commands, browse the web, or create files. You work with what you know and what is given to you in this message.

## How to be useful every run
- **Read the task first.** Understand what is being asked before writing anything.
- **Complete the work NOW, in full.** Never say "I will do X in the next step" or "I'll check back later" — there is no later turn.
- **Write concrete output.** Plans, decisions, analysis, recommendations — not narration about what you're going to do.
- **Be direct.** Skip filler phrases like "As an AI agent, I will assist you with…"

## What Paperclip is
Paperclip orchestrates AI agents across goals and issues. Each agent is assigned to issues,
wakes up when triggered, produces a text response, and the response is recorded as a comment.
Humans and other agents can then react to that comment in subsequent runs.\
`;

function buildContextNote(context: Record<string, unknown>): string {
  const parts: string[] = [];
  const taskId =
    (typeof context.taskId === "string" && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim()) ||
    null;
  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim()
      ? context.wakeReason.trim()
      : null;
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim()) ||
    null;
  const approvalId =
    typeof context.approvalId === "string" && context.approvalId.trim()
      ? context.approvalId.trim()
      : null;
  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim()
      ? context.approvalStatus.trim()
      : null;
  if (taskId) parts.push(`Task ID: ${taskId}`);
  if (wakeReason) parts.push(`Wake reason: ${wakeReason}`);
  if (wakeCommentId) parts.push(`Wake comment ID: ${wakeCommentId}`);
  if (approvalId) parts.push(`Approval ID: ${approvalId}`);
  if (approvalStatus) parts.push(`Approval status: ${approvalStatus}`);
  return parts.join("\n");
}

/**
 * Try to resolve a possibly-untagged model name (e.g. "llama3.2") to the exact
 * name Ollama has installed (e.g. "llama3.2:3b").  Falls back to the original
 * name if the tags API is unavailable or no match is found.
 */
async function resolveModelName(baseUrl: string, requested: string): Promise<string> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return requested;
    const body = (await res.json()) as Record<string, unknown>;
    if (!Array.isArray(body.models)) return requested;
    const names: string[] = (body.models as Record<string, unknown>[])
      .filter((m) => typeof m.name === "string")
      .map((m) => m.name as string);

    // 1. Exact match
    if (names.includes(requested)) return requested;

    // 2. Exact match ignoring case
    const lower = requested.toLowerCase();
    const exact = names.find((n) => n.toLowerCase() === lower);
    if (exact) return exact;

    // 3. Base-name fallback — only when the requested model has no explicit tag.
    //    A tagged request like "qwen2.5-coder:32b" must not silently resolve
    //    to "qwen2.5-coder:7b" just because it was installed first.
    if (!requested.includes(":")) {
      const requestedBase = requested.toLowerCase();
      const baseMatch = names.find(
        (n) => n.split(":")[0].toLowerCase() === requestedBase,
      );
      if (baseMatch) return baseMatch;
    }
  } catch {
    // network error / timeout — continue with original name
  }
  return requested;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta } = ctx;

  const baseUrl = asString(config.baseUrl, DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: `Invalid Ollama base URL: "${baseUrl}". Only http:// and https:// are allowed.`,
      provider: "ollama",
      model: asString(config.model, DEFAULT_OLLAMA_MODEL),
    };
  }
  const rawModel = asString(config.model, DEFAULT_OLLAMA_MODEL).trim();
  const timeoutSec = asNumber(config.timeoutSec, DEFAULT_OLLAMA_TIMEOUT_SEC);
  const temperature =
    typeof config.temperature === "number" && Number.isFinite(config.temperature)
      ? config.temperature
      : undefined;
  let systemPrompt = asString(config.system, DEFAULT_SYSTEM_PROMPT);

  // Inject top-K memories BEFORE skills so memories sit next to the base
  // persona prompt rather than inside the skills block (which uses ---
  // dividers that models may read as part of skill content).
  const injectedMemories = ctx.agentMemoriesForInjection;
  if (injectedMemories && injectedMemories.length > 0) {
    const agentWiki = injectedMemories.filter((m) => m.wikiSlug && m.source !== "company");
    const companyWiki = injectedMemories.filter((m) => m.wikiSlug && m.source === "company");
    const agentEpisodic = injectedMemories.filter((m) => !m.wikiSlug && m.source !== "company");
    const companyEpisodic = injectedMemories.filter((m) => !m.wikiSlug && m.source === "company");
    const sections: string[] = [];
    if (agentWiki.length > 0) {
      sections.push([
        "## Knowledge base",
        ...agentWiki.map((m) => `### ${m.wikiSlug}\n${m.content}`),
      ].join("\n\n"));
    }
    if (companyWiki.length > 0 || companyEpisodic.length > 0) {
      const companyItems = [
        ...companyWiki.map((m) => `### ${m.wikiSlug}\n${m.content}`),
        ...companyEpisodic.map((m, i) => `${i + 1}. ${m.content}`),
      ];
      sections.push(["## Company knowledge", ...companyItems].join("\n\n"));
    }
    if (agentEpisodic.length > 0) {
      sections.push([
        "## Relevant memories",
        ...agentEpisodic.map((m, i) => `${i + 1}. ${m.content}`),
      ].join("\n"));
    }
    systemPrompt = `${systemPrompt}\n\n${sections.join("\n\n")}`;
  }

  // Inject company skills into the system prompt.
  const skillEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredSkillNames = new Set(resolveOllamaDesiredSkillNames(config, skillEntries));
  if (desiredSkillNames.size > 0) {
    const skillMarkdowns = (
      await Promise.all(
        skillEntries
          .filter((e) => desiredSkillNames.has(e.key))
          .map((e) => readPaperclipSkillMarkdown(__moduleDir, e.key)),
      )
    ).filter((md): md is string => md !== null);
    if (skillMarkdowns.length > 0) {
      systemPrompt = `${systemPrompt}\n\n${skillMarkdowns.join("\n\n---\n\n")}`;
    }
  }

  // Resolve the model name against what Ollama actually has installed.
  // e.g. config says "llama3.2" but Ollama stores it as "llama3.2:3b".
  const model = await resolveModelName(baseUrl, rawModel);

  const promptTemplate = asString(
    config.promptTemplate,
    // Default: surface the task title + description so the model always knows what it's doing.
    // Agents can override this via config.promptTemplate for custom framing.
    `You are {{agent.name}}, a Paperclip agent.

## Your current task
**{{context.paperclipWake.issue.title}}**

{{context.paperclipWake.issue.description}}

---
Complete this task in full in your response. Do not defer to a future turn.`,
  );
  const templateData = {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId },
    context,
  };
  const renderedPrompt = renderTemplate(promptTemplate, templateData);

  // Annotate user message with Paperclip context
  const contextNote = buildContextNote(context);
  const userContent = contextNote.length > 0 ? `${contextNote}\n\n${renderedPrompt}` : renderedPrompt;

  // Rehydrate prior conversation history from session, capped to prevent
  // unbounded growth.  Keep the most recent N turn-pairs (user+assistant).
  const maxHistoryTurns = asNumber(config.maxHistoryTurns, DEFAULT_OLLAMA_MAX_HISTORY_TURNS);
  const sessionParams = parseObject(runtime.sessionParams);
  const priorMessages: OllamaMessage[] = (() => {
    if (!Array.isArray(sessionParams.messages)) return [];
    const all = (sessionParams.messages as unknown[]).filter(
      (m): m is OllamaMessage =>
        typeof m === "object" &&
        m !== null &&
        !Array.isArray(m) &&
        (typeof (m as Record<string, unknown>).role === "string") &&
        (typeof (m as Record<string, unknown>).content === "string"),
    );
    // Keep only the last maxHistoryTurns * 2 messages (each turn is user+assistant)
    if (maxHistoryTurns > 0 && all.length > maxHistoryTurns * 2) {
      return all.slice(-maxHistoryTurns * 2);
    }
    return all;
  })();

  const messages: OllamaMessage[] = [
    { role: "system", content: systemPrompt },
    ...priorMessages,
    { role: "user", content: userContent },
  ];

  // Emit Paperclip-standard env vars for logging/meta (no subprocess, but agent needs context)
  const paperclipEnv = buildPaperclipEnv(agent);

  if (onMeta) {
    await onMeta({
      adapterType: "ollama_local",
      command: `POST ${baseUrl}/api/chat`,
      cwd: process.cwd(),
      commandNotes: [
        `Model: ${model}`,
        `Prior conversation turns: ${Math.floor(priorMessages.length / 2)}`,
        `Streaming: true`,
      ],
      commandArgs: [],
      env: {
        PAPERCLIP_AGENT_ID: paperclipEnv.PAPERCLIP_AGENT_ID ?? agent.id,
        PAPERCLIP_COMPANY_ID: paperclipEnv.PAPERCLIP_COMPANY_ID ?? agent.companyId,
      },
      prompt: userContent,
      promptMetrics: {
        promptChars: userContent.length,
        heartbeatPromptChars: renderedPrompt.length,
      },
      context,
    });
  }

  // Set up AbortController for timeout
  const controller = new AbortController();
  let timedOut = false;
  const timeoutHandle =
    timeoutSec > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutSec * 1000)
      : null;

  // Whether to enable Paperclip tool calling (default on; set enableTools:false in config to opt out).
  const enableTools = asBoolean(config.enableTools, true);
  const maxToolIterations = asNumber(config.maxToolIterations, 10);
  const apiContext = buildPaperclipApiContext(agent, ctx.authToken);

  let assistantContent = "";
  let promptEvalCount = 0;
  let evalCount = 0;
  let exitCode: number | null = null;
  let errorMessage: string | null = null;
  // Tracks the full message history for session persistence.
  let sessionMessages: Array<Record<string, unknown>> = [];

  try {
    // -------------------------------------------------------------------------
    // Path A — Agentic tool loop (non-streaming, multi-turn tool calls).
    // Allows the model to call Paperclip APIs (create issues, hire agents, etc.)
    // and receive results before producing its final text response.
    // Falls back to Path B if the model reports it doesn't support tools.
    // -------------------------------------------------------------------------
    let toolsUsed = false;

    if (enableTools) {
      const loopMessages: Array<Record<string, unknown>> = [
        { role: "system", content: systemPrompt },
        ...(priorMessages as unknown as Array<Record<string, unknown>>),
        { role: "user", content: userContent },
      ];

      let toolsSupported = true;

      for (let iteration = 0; iteration < maxToolIterations; iteration++) {
        if (timedOut) break;

        const reqBody: Record<string, unknown> = {
          model,
          messages: loopMessages,
          tools: PAPERCLIP_TOOLS,
          stream: false,
        };
        if (temperature !== undefined) reqBody.options = { temperature };

        const res = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
          signal: controller.signal,
        });

        if (!res.ok) {
          const bodyText = await res.text().catch(() => "");
          // Graceful fallback: model doesn't support tool calling → use streaming path.
          if (
            res.status === 400 &&
            (bodyText.toLowerCase().includes("does not support tools") ||
              bodyText.toLowerCase().includes("tool") ||
              bodyText.toLowerCase().includes("function"))
          ) {
            toolsSupported = false;
            break;
          }
          const errMsg = bodyText.trim() || `HTTP ${res.status} ${res.statusText}`;
          const errLine: OllamaErrorLine = { type: "error", message: errMsg };
          await onLog("stderr", JSON.stringify(errLine) + "\n");
          return {
            exitCode: 1,
            signal: null,
            timedOut: false,
            errorMessage: `Ollama returned ${res.status}: ${errMsg}`,
            provider: "ollama",
            model,
            resultJson: { error: errMsg },
          };
        }

        const json = (await res.json()) as Record<string, unknown>;
        promptEvalCount += asNumber(json.prompt_eval_count, 0);
        evalCount += asNumber(json.eval_count, 0);

        const msgObj =
          typeof json.message === "object" && json.message !== null
            ? (json.message as Record<string, unknown>)
            : {};

        const rawToolCalls = Array.isArray(msgObj.tool_calls) ? msgObj.tool_calls : [];
        const toolCalls = rawToolCalls.filter(
          (tc): tc is OllamaToolCall =>
            typeof tc === "object" &&
            tc !== null &&
            typeof (tc as Record<string, unknown>).function === "object",
        );

        if (toolCalls.length === 0) {
          // No tool calls — model produced its final text response.
          // Switch to stream:true for this final response so tokens appear
          // incrementally in the UI instead of all at once.
          const finalContent = typeof msgObj.content === "string" ? msgObj.content : "";

          if (finalContent) {
            // Emit the already-fetched final content as a single chunk.
            // A second streaming sub-request would double latency and risk
            // non-deterministic content; the non-streaming response is authoritative.
            assistantContent = finalContent;
            await onLog(
              "stdout",
              JSON.stringify({ type: "chunk", content: assistantContent } satisfies OllamaChunkLine) + "\n",
            );
          }

          await onLog(
            "stdout",
            JSON.stringify({
              type: "done",
              model,
              prompt_eval_count: promptEvalCount,
              eval_count: evalCount,
              total_duration_ns: 0,
            } satisfies OllamaDoneLine) + "\n",
          );
          toolsUsed = true;
          exitCode = 0;
          // Build session history: exclude system message, include tool turns.
          sessionMessages = loopMessages.slice(1); // drop system
          if (assistantContent) {
            sessionMessages.push({ role: "assistant", content: assistantContent });
          }
          break;
        }

        // Add the assistant turn (with tool_calls) to loop history.
        loopMessages.push({ ...msgObj, role: "assistant" });

        // Execute each tool call against the Paperclip API.
        for (const tc of toolCalls) {
          await onLog(
            "stdout",
            JSON.stringify({ type: "tool_call", name: tc.function.name, args: tc.function.arguments }) + "\n",
          );

          const result = await executePaperclipTool(tc, apiContext);
          const resultStr = JSON.stringify(result);

          await onLog(
            "stdout",
            JSON.stringify({
              type: "tool_result",
              name: tc.function.name,
              result: resultStr.slice(0, 1000),
            }) + "\n",
          );

          // Feed result back to the model as a tool message.
          loopMessages.push({ role: "tool", content: resultStr });
        }
      }

      if (!toolsSupported) {
        // Model doesn't support tools → fall through to the streaming path.
        toolsUsed = false;
      } else if (exitCode !== 0 && !timedOut) {
        // Max iterations hit without a clean text response — treat as success with whatever we have.
        exitCode = 0;
        toolsUsed = true;
      }
    }

    // -------------------------------------------------------------------------
    // Path B — Streaming text-only path (no tool calls).
    // Used when tools are disabled, or when the model doesn't support tools.
    // -------------------------------------------------------------------------
    if (!toolsUsed) {
    const requestBody: Record<string, unknown> = {
      model,
      messages,
      stream: true,
    };
    if (temperature !== undefined) {
      requestBody.options = { temperature };
    }

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      const errMsg = bodyText.trim() || `HTTP ${response.status} ${response.statusText}`;
      const errLine: OllamaErrorLine = { type: "error", message: errMsg };
      await onLog("stderr", JSON.stringify(errLine) + "\n");
      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        errorMessage: `Ollama returned ${response.status}: ${errMsg}`,
        provider: "ollama",
        model,
        resultJson: { error: errMsg },
      };
    }

    if (!response.body) {
      throw new Error("Ollama response has no body");
    }

    const reader = response.body.getReader();
    try {
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line) as Record<string, unknown>;
        } catch {
          await onLog("stdout", line + "\n");
          continue;
        }

        const isDone = parsed.done === true;
        const messageObj =
          typeof parsed.message === "object" && parsed.message !== null
            ? (parsed.message as Record<string, unknown>)
            : null;
        const contentChunk =
          typeof messageObj?.content === "string" ? messageObj.content : "";

        if (!isDone && contentChunk) {
          assistantContent += contentChunk;
          const chunkLine: OllamaChunkLine = { type: "chunk", content: contentChunk };
          await onLog("stdout", JSON.stringify(chunkLine) + "\n");
        }

        if (isDone) {
          promptEvalCount =
            typeof parsed.prompt_eval_count === "number" ? parsed.prompt_eval_count : 0;
          evalCount = typeof parsed.eval_count === "number" ? parsed.eval_count : 0;
          const totalDurationNs =
            typeof parsed.total_duration === "number" ? parsed.total_duration : 0;
          const doneLine: OllamaDoneLine = {
            type: "done",
            model: typeof parsed.model === "string" ? parsed.model : model,
            prompt_eval_count: promptEvalCount,
            eval_count: evalCount,
            total_duration_ns: totalDurationNs,
          };
          await onLog("stdout", JSON.stringify(doneLine) + "\n");
        }
      }
    }

    // Parse any trailing data left in the buffer after EOF
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim()) as Record<string, unknown>;
        // /api/chat uses message.content; /api/generate uses response
        const msg = parsed.message as Record<string, unknown> | undefined;
        const chunk = typeof msg?.content === "string" ? msg.content : typeof parsed.response === "string" ? parsed.response : null;
        if (chunk) {
          assistantContent += chunk;
        }
        if (parsed.done === true) {
          promptEvalCount += asNumber(parsed.prompt_eval_count, 0);
          evalCount += asNumber(parsed.eval_count, 0);
        }
      } catch {
        // malformed trailing data — ignore
      }
    }

    } finally {
      reader.cancel().catch(() => {});
    }

    exitCode = 0;
    } // end Path B
  } catch (err) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (timedOut) {
      return {
        exitCode: null,
        signal: null,
        timedOut: true,
        errorMessage: `Timed out after ${timeoutSec}s`,
        provider: "ollama",
        model,
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("ECONNREFUSED") ||
      msg.includes("fetch failed") ||
      msg.includes("connect EREFUSED") ||
      msg.includes("Failed to fetch")
    ) {
      const errLine: OllamaErrorLine = {
        type: "error",
        message: `Cannot reach Ollama at ${baseUrl}: ${msg}`,
      };
      await onLog("stderr", JSON.stringify(errLine) + "\n");
      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        errorMessage: `Cannot reach Ollama at ${baseUrl}. Is Ollama running? Run: ollama serve`,
        errorCode: "ollama_not_running",
        provider: "ollama",
        model,
      };
    }
    const errLine: OllamaErrorLine = { type: "error", message: msg };
    await onLog("stderr", JSON.stringify(errLine) + "\n");
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: msg,
      provider: "ollama",
      model,
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  // Guard against race where timeout fires just as the stream finishes
  if (timedOut) {
    return {
      exitCode: null,
      signal: null,
      timedOut: true,
      errorMessage: `Timed out after ${timeoutSec}s`,
      provider: "ollama",
      model,
    };
  }

  // Build updated session params with appended message history.
  // When tools were used, sessionMessages already contains the full loop history
  // (user turn + tool turns + final assistant turn), so use that directly.
  // Otherwise fall back to the simple prior + user + assistant structure.
  const updatedMessages: Array<Record<string, unknown>> =
    sessionMessages.length > 0
      ? sessionMessages
      : [
          ...(priorMessages as unknown as Array<Record<string, unknown>>),
          { role: "user", content: userContent },
          ...(assistantContent ? [{ role: "assistant", content: assistantContent }] : []),
        ];

  return {
    exitCode,
    signal: null,
    timedOut: false,
    errorMessage: exitCode === 0 ? null : (errorMessage ?? `Ollama exited with code ${exitCode}`),
    usage:
      promptEvalCount || evalCount
        ? { inputTokens: promptEvalCount, outputTokens: evalCount }
        : undefined,
    provider: "ollama",
    model,
    billingType: "subscription",
    sessionParams: updatedMessages.length > 0 ? { messages: updatedMessages } : null,
    summary: assistantContent.trim() || null,
  };
}
