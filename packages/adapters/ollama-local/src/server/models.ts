import { DEFAULT_OLLAMA_BASE_URL, models as staticModels } from "../index.js";

export async function listOllamaModels(opts?: { baseUrl?: string }): Promise<{ id: string; label: string }[]> {
  const baseUrl = (opts?.baseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, "");
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return staticModels;
    const body = (await res.json()) as Record<string, unknown>;
    if (!Array.isArray(body.models)) return staticModels;
    const dynamic = (body.models as Record<string, unknown>[])
      .filter((m) => typeof m.name === "string")
      .map((m) => {
        const name = m.name as string;
        const base = name.split(":")[0];
        const tag = name.includes(":") ? name.split(":")[1] : null;
        const label = tag && tag !== "latest" ? `${base} (${tag})` : base;
        return { id: name, label };
      });
    return dynamic.length > 0 ? dynamic : staticModels;
  } catch {
    return staticModels;
  }
}
