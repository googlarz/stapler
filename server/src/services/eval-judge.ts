/**
 * LLM-as-judge scoring service for eval case results.
 *
 * Sends the agent's output + natural-language criteria to an LLM and
 * receives a 0–10 score + reasoning string. The score is normalised to
 * 0.0–1.0 before storage.
 *
 * Provider selection (mirrors embeddings.ts pattern):
 *   - OPENAI_API_KEY present → OpenAI chat completions (gpt-4o-mini)
 *   - STAPLER_OLLAMA_HOST set → Ollama (uses STAPLER_OLLAMA_JUDGE_MODEL,
 *     default "llama3.2")
 *   - Neither → falls back to heuristic: 1.0 if output non-empty, else 0.0
 */

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_JUDGE_MODEL = "gpt-4o-mini";

const DEFAULT_OLLAMA_HOST = "http://localhost:11434";
const DEFAULT_OLLAMA_JUDGE_MODEL = "llama3.2";

export interface JudgeResult {
  score: number;      // 0.0–1.0
  reasoning: string;
}

function buildJudgePrompt(criteria: string, output: string): string {
  return `You are an objective evaluator. Score the agent output against the given criteria.

CRITERIA:
${criteria}

AGENT OUTPUT:
${output || "(no output captured)"}

Respond with ONLY valid JSON in this exact format (no prose, no markdown):
{"score": <integer 0-10>, "reasoning": "<one sentence explanation>"}

Score 0 = completely failed criteria, 10 = perfectly met criteria.`;
}

async function judgeWithOpenAI(criteria: string, output: string): Promise<JudgeResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_JUDGE_MODEL,
        messages: [{ role: "user", content: buildJudgePrompt(criteria, output) }],
        temperature: 0,
        max_tokens: 256,
      }),
    });

    if (!response.ok) {
      console.warn(`[eval-judge] OpenAI ${response.status}: ${await response.text().catch(() => "")}`);
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data?.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(content) as { score?: unknown; reasoning?: unknown };
    const rawScore = Number(parsed.score);
    if (!Number.isFinite(rawScore)) return null;
    return {
      score: Math.max(0, Math.min(10, rawScore)) / 10,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch (err) {
    console.warn("[eval-judge] OpenAI judge failed:", err);
    return null;
  }
}

async function judgeWithOllama(criteria: string, output: string): Promise<JudgeResult | null> {
  const host = process.env.STAPLER_OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST;
  const model = process.env.STAPLER_OLLAMA_JUDGE_MODEL ?? DEFAULT_OLLAMA_JUDGE_MODEL;

  try {
    const response = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: buildJudgePrompt(criteria, output) }],
        stream: false,
        options: { temperature: 0 },
      }),
    });

    if (!response.ok) {
      console.warn(`[eval-judge] Ollama ${response.status}: ${await response.text().catch(() => "")}`);
      return null;
    }

    const data = (await response.json()) as {
      message?: { content?: string };
    };
    const content = data?.message?.content?.trim() ?? "";
    // Extract JSON from response (may be wrapped in markdown fences)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as { score?: unknown; reasoning?: unknown };
    const rawScore = Number(parsed.score);
    if (!Number.isFinite(rawScore)) return null;
    return {
      score: Math.max(0, Math.min(10, rawScore)) / 10,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch (err) {
    console.warn("[eval-judge] Ollama judge failed:", err);
    return null;
  }
}

/**
 * Score an agent's output against the given eval criteria.
 *
 * Returns a JudgeResult with score 0.0–1.0 and a reasoning string.
 * Falls back gracefully when no LLM is configured:
 *   - non-empty output → score 0.5 (neutral)
 *   - empty output     → score 0.0
 */
export async function judgeOutput(criteria: string, output: string): Promise<JudgeResult> {
  // Try OpenAI first (higher quality), then Ollama, then heuristic
  const result =
    (await judgeWithOpenAI(criteria, output)) ??
    (await judgeWithOllama(criteria, output));

  if (result) return result;

  // Heuristic fallback — just check if something was produced
  const hasOutput = output.trim().length > 0;
  return {
    score: hasOutput ? 0.5 : 0,
    reasoning: hasOutput
      ? "No LLM judge configured; output is non-empty (neutral score)."
      : "No LLM judge configured; no output was produced.",
  };
}
