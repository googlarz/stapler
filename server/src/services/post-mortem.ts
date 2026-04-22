/**
 * Post-mortem pipeline — Pillar 3 of the Quality Flywheel.
 *
 * When a run scores poorly (score < 0.5) or receives a 👎 vote, this service:
 *   1. Extracts a root-cause diagnosis + a reusable rule from the run transcript.
 *   2. Saves the rule as a tagged agent memory so it injects into future runs.
 *
 * Provider cascade mirrors eval-judge.ts:
 *   OpenAI (gpt-4o-mini) → Ollama → silent no-op (no rule extracted).
 *
 * Fire-and-forget: callers use `void runPostMortem(...).catch(...)`.
 * Failures here never block runs or votes.
 */

import type { Db } from "@stapler/db";
import { agents, heartbeatRuns } from "@stapler/db";
import { eq } from "drizzle-orm";
import { agentMemoryService } from "./agent-memories.js";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OLLAMA_HOST = "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL = "llama3.2";

export interface PostMortemResult {
  diagnosis: string;
  rule: string;
  appliesWhen: string;
}

const SYSTEM_PROMPT = `You are a root-cause analyst reviewing why an agent run failed or produced poor-quality output.

Given the agent's run output (and optionally a human feedback reason), your job is to:
1. Write a one-sentence diagnosis of what went wrong.
2. Write a durable, actionable RULE the agent can follow to avoid this failure in the future.
3. Write a one-sentence appliesWhen clause describing when this rule is relevant.

Rules:
- The RULE must be prescriptive ("Always ...", "When X, do Y instead of Z").
- Keep each field under 300 characters.
- Do NOT restate the diagnosis in the rule — the rule must be forward-looking guidance.
- Return ONLY valid JSON. No prose, no markdown fences.

Format: {"diagnosis": "...", "rule": "...", "appliesWhen": "..."}`;

async function extractWithOpenAI(
  excerpt: string,
  feedbackReason: string | null,
): Promise<PostMortemResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const userContent = feedbackReason
      ? `Run output:\n${excerpt.slice(0, 6000)}\n\nHuman feedback reason: "${feedbackReason}"`
      : `Run output:\n${excerpt.slice(0, 6000)}`;
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        temperature: 0,
        max_tokens: 512,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data?.choices?.[0]?.message?.content?.trim() ?? "";
    return JSON.parse(content) as PostMortemResult;
  } catch {
    return null;
  }
}

async function extractWithOllama(
  excerpt: string,
  feedbackReason: string | null,
): Promise<PostMortemResult | null> {
  const host = process.env.STAPLER_OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST;
  const model = process.env.STAPLER_OLLAMA_JUDGE_MODEL ?? DEFAULT_OLLAMA_MODEL;
  try {
    const userContent = feedbackReason
      ? `Run output:\n${excerpt.slice(0, 6000)}\n\nHuman feedback reason: "${feedbackReason}"`
      : `Run output:\n${excerpt.slice(0, 6000)}`;
    const res = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        stream: false,
        options: { temperature: 0 },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { content?: string } };
    const raw = data?.message?.content?.trim() ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as PostMortemResult;
  } catch {
    return null;
  }
}

/**
 * Run a post-mortem on a heartbeat run and save the resulting rule
 * as an agent memory tagged `["rule", "post-mortem"]`.
 *
 * @param runId          heartbeat_run.id
 * @param feedbackReason Optional human explanation (from a 👎 vote)
 */
export async function runPostMortem(
  db: Db,
  runId: string,
  feedbackReason: string | null = null,
): Promise<void> {
  // Load the run
  const runRows = await db
    .select({
      agentId: heartbeatRuns.agentId,
      companyId: heartbeatRuns.companyId,
      stdoutExcerpt: heartbeatRuns.stdoutExcerpt,
    })
    .from(heartbeatRuns)
    .where(eq(heartbeatRuns.id, runId))
    .limit(1);
  const run = runRows[0];
  if (!run?.stdoutExcerpt || run.stdoutExcerpt.trim().length < 20) return;

  const result =
    (await extractWithOpenAI(run.stdoutExcerpt, feedbackReason)) ??
    (await extractWithOllama(run.stdoutExcerpt, feedbackReason));

  if (!result?.rule || result.rule.trim().length < 5) return;

  // Format the memory content: rule + appliesWhen context
  const memoryContent = result.appliesWhen
    ? `[Rule] ${result.rule.trim()} (${result.appliesWhen.trim()})`
    : `[Rule] ${result.rule.trim()}`;

  try {
    await agentMemoryService(db).save({
      agentId: run.agentId,
      companyId: run.companyId,
      content: memoryContent.slice(0, 2000), // stay within content limit
      tags: ["rule", "post-mortem"],
      runId,
    });
  } catch {
    // Dedup or content-too-large — swallow silently.
  }
}

/**
 * Fire a post-mortem when a run scores below threshold.
 * Called from run-scorer after writing the score.
 */
export async function maybeRunPostMortemOnLowScore(
  db: Db,
  runId: string,
  score: number,
  threshold = 0.5,
): Promise<void> {
  if (score >= threshold) return;
  await runPostMortem(db, runId, null);
}
