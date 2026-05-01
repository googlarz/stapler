export { execute, resolveSystemPrompt, DEFAULT_SYSTEM_PROMPT } from "./execute.js";
export type { OpenAiStdoutLine, OpenAiChunkLine, OpenAiDoneLine, OpenAiErrorLine } from "./execute.js";

import type { AdapterSessionCodec } from "@stapler/adapter-utils";

/**
 * Session codec — stores conversation history as an OpenAI-format messages array.
 * Schema is identical to ollama-local's sessionCodec so session state is
 * interchangeable between adapters.
 */
function isValidMessage(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (
    (rec.role === "user" || rec.role === "assistant" || rec.role === "tool" || rec.role === "system") &&
    (typeof rec.content === "string" || rec.content === null)
  );
}

export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw: unknown) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    if (!Array.isArray(record.messages)) return null;
    const messages = (record.messages as unknown[]).filter(isValidMessage);
    if (messages.length === 0) return null;
    return { messages };
  },
  serialize(params: Record<string, unknown> | null) {
    if (!params) return null;
    if (!Array.isArray(params.messages)) return null;
    const messages = (params.messages as unknown[]).filter(isValidMessage);
    if (messages.length === 0) return null;
    return { messages };
  },
  getDisplayId(params: Record<string, unknown> | null) {
    if (!params) return null;
    if (!Array.isArray(params.messages)) return null;
    const userTurns = (params.messages as unknown[]).filter(
      (m) => isValidMessage(m) && m.role === "user",
    ).length;
    if (userTurns === 0) return null;
    return `${userTurns} prior turn${userTurns !== 1 ? "s" : ""}`;
  },
};

/**
 * List models from an OpenAI-compatible endpoint.
 * Returns the adapter's static model list on failure.
 */
export async function listOpenAiCompatModels(
  baseUrl = "http://localhost:4000",
  apiKey = "",
): Promise<Array<{ id: string; label: string }>> {
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as Record<string, unknown>;
    if (!Array.isArray(body.data)) return [];
    return (body.data as Array<Record<string, unknown>>)
      .filter((m) => typeof m.id === "string")
      .map((m) => ({ id: m.id as string, label: m.id as string }));
  } catch {
    return [];
  }
}

/**
 * Minimal environment check — verify the proxy is reachable.
 */
export async function testEnvironment(ctx: import("@stapler/adapter-utils").AdapterEnvironmentTestContext): Promise<import("@stapler/adapter-utils").AdapterEnvironmentTestResult> {
  const baseUrl = typeof (ctx.config.baseUrl) === "string"
    ? (ctx.config.baseUrl as string).replace(/\/$/, "")
    : "http://localhost:4000";
  const apiKey = typeof ctx.config.apiKey === "string" ? ctx.config.apiKey : "";

  const checks: import("@stapler/adapter-utils").AdapterEnvironmentCheck[] = [];

  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await fetch(`${baseUrl}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      checks.push({
        code: "proxy_reachable",
        level: "info",
        message: `OpenAI-compatible proxy reachable at ${baseUrl}`,
      });
    } else {
      checks.push({
        code: "proxy_http_error",
        level: "warn",
        message: `Proxy at ${baseUrl} returned HTTP ${res.status}`,
        hint: res.status === 401 ? "Check that apiKey is correct" : undefined,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({
      code: "proxy_not_reachable",
      level: "error",
      message: `Cannot reach proxy at ${baseUrl}: ${msg}`,
      hint: "Start the proxy first: litellm --config config.yaml",
    });
  }

  const hasError = checks.some((c) => c.level === "error");
  const hasWarn = checks.some((c) => c.level === "warn");

  return {
    adapterType: "openai_compat",
    status: hasError ? "fail" : hasWarn ? "warn" : "pass",
    checks,
    testedAt: new Date().toISOString(),
  };
}
