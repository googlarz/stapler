/**
 * Auto-memory extraction from completed agent runs.
 *
 * When `autoExtractMemories: true` is set in an agent's adapterConfig,
 * this service is called after each successful run. It sends the run's
 * stdout excerpt to an LLM and extracts up to 3 short factual memories
 * that are then saved to the agent's memory store.
 *
 * Provider selection mirrors eval-judge.ts:
 *   OpenAI (gpt-4o-mini) → Ollama fallback → silent no-op
 *
 * Fire-and-forget: callers use void + .catch() so a failure here never
 * blocks or crashes the run finalization path.
 */

import type { Db } from "@stapler/db";
import { agentMemoryService } from "./agent-memories.js";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OLLAMA_HOST = "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL = "llama3.2";

const EXTRACTION_PROMPT = `You are a knowledge extractor. Given an agent's run output, extract up to 3 short, self-contained factual statements worth remembering for future runs.

Rules:
- Each fact must be a single sentence under 200 characters.
- Only extract facts that would be useful context in a FUTURE run (e.g. "The repo uses pnpm workspaces", "Tests run with vitest", "Deploy via fly.io").
- Do NOT extract transient facts (e.g. "today is Tuesday", "user asked for X").
- Return ONLY valid JSON — no prose, no markdown.
- If nothing is worth remembering, return an empty array.

Format: {"facts": ["fact1", "fact2"]}`;

async function extractWithOpenAI(excerpt: string): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: `Run output:\n${excerpt.slice(0, 8000)}` },
        ],
        temperature: 0,
        max_tokens: 512,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data?.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(content) as { facts?: unknown };
    if (!Array.isArray(parsed.facts)) return [];
    return (parsed.facts as unknown[])
      .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
      .slice(0, 3);
  } catch {
    return [];
  }
}

async function extractWithOllama(excerpt: string): Promise<string[]> {
  const host = process.env.STAPLER_OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST;
  const model = process.env.STAPLER_OLLAMA_JUDGE_MODEL ?? DEFAULT_OLLAMA_MODEL;

  try {
    const res = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: `Run output:\n${excerpt.slice(0, 8000)}` },
        ],
        stream: false,
        options: { temperature: 0 },
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { message?: { content?: string } };
    const content = data?.message?.content?.trim() ?? "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as { facts?: unknown };
    if (!Array.isArray(parsed.facts)) return [];
    return (parsed.facts as unknown[])
      .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
      .slice(0, 3);
  } catch {
    return [];
  }
}

/**
 * Called after a successful agent run when `autoExtractMemories: true`.
 * Extracts facts from stdoutExcerpt and saves them as agent memories
 * tagged `["auto-extracted"]`. Silent no-op if no LLM is configured or
 * the excerpt is empty.
 */
export async function maybeAutoExtractMemories(
  db: Db,
  agent: { id: string; companyId: string; adapterConfig: unknown },
  runId: string,
  stdoutExcerpt: string,
): Promise<void> {
  const config =
    typeof agent.adapterConfig === "object" && agent.adapterConfig !== null
      ? (agent.adapterConfig as Record<string, unknown>)
      : {};

  if (config.autoExtractMemories !== true) return;
  if (!stdoutExcerpt || stdoutExcerpt.trim().length < 50) return;

  const facts =
    (await extractWithOpenAI(stdoutExcerpt)).length > 0
      ? await extractWithOpenAI(stdoutExcerpt)
      : await extractWithOllama(stdoutExcerpt);

  if (facts.length === 0) return;

  const svc = agentMemoryService(db);
  for (const fact of facts) {
    try {
      await svc.save({
        agentId: agent.id,
        companyId: agent.companyId,
        content: fact,
        tags: ["auto-extracted"],
        runId,
      });
    } catch {
      // Dedup conflict (ON CONFLICT DO NOTHING) or size limit — swallow silently.
    }
  }
}
