/**
 * Semantic embedding service.
 *
 * Two providers, selected via STAPLER_EMBEDDING_PROVIDER:
 *
 *   - "openai"  (default) — text-embedding-3-small, 1536 dims.
 *                           Requires OPENAI_API_KEY. Best multilingual
 *                           quality, ~$0.02/1M tokens.
 *
 *   - "ollama"             — runs a dedicated embedding model on a local
 *                           Ollama server (typically qwen3-embedding:8b,
 *                           4096 dims native). Fully offline, zero cost,
 *                           strong multilingual performance. Needs a
 *                           running Ollama with the model pulled.
 *
 * When no provider is configured (no API key, no reachable Ollama),
 * all functions gracefully return null / 0 — the caller falls back to
 * pg_trgm keyword search.
 *
 * Designed for small-corpus use. App-side cosine similarity over the full
 * table is sub-millisecond at typical Stapler scale. No vector index needed;
 * when pgvector becomes available in embedded-postgres the `real[]` column
 * can migrate to `vector(N)` + HNSW without code changes.
 *
 * Switching providers mid-deployment: stored vectors from provider A are in
 * a completely different vector space from provider B and are incomparable.
 * Either re-embed every row, or pick one provider and stick with it.
 */

type EmbeddingProvider = "openai" | "ollama";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const OPENAI_EMBEDDING_DIMS = 1536;

const DEFAULT_OLLAMA_HOST = "http://localhost:11434";
const DEFAULT_OLLAMA_EMBEDDING_MODEL = "qwen3-embedding:8b";

function getProvider(): EmbeddingProvider {
  const raw = process.env.STAPLER_EMBEDDING_PROVIDER?.trim().toLowerCase();
  if (raw === "ollama") return "ollama";
  return "openai"; // default
}

/**
 * Cosine similarity threshold below which a candidate is excluded from
 * semantic search results. Value depends on the model — text-embedding-3-small
 * clusters tighter than qwen3-embedding. Defaults tuned for German-rich
 * content in both cases.
 * Override with STAPLER_EMBEDDING_THRESHOLD env var.
 */
export function getEmbeddingThreshold(): number {
  const raw = process.env.STAPLER_EMBEDDING_THRESHOLD;
  if (raw) {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n >= -1 && n <= 1) return n;
  }
  return 0.25;
}

interface OpenAIEmbeddingResponse {
  object: "list";
  data: Array<{ object: "embedding"; embedding: number[]; index: number }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

/**
 * Get an embedding from OpenAI's text-embedding-3-small (1536 dims).
 * Returns null on missing API key, network failure, or malformed response.
 */
async function getOpenAIEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_EMBEDDING_MODEL,
        input: text,
        encoding_format: "float",
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn(
        `[embeddings] OpenAI API ${response.status} ${response.statusText}: ${body.slice(0, 200)}`,
      );
      return null;
    }

    const data = (await response.json()) as OpenAIEmbeddingResponse;
    const embedding = data?.data?.[0]?.embedding;

    if (!Array.isArray(embedding) || embedding.length !== OPENAI_EMBEDDING_DIMS) {
      console.warn(
        `[embeddings] Unexpected OpenAI embedding shape: got ${Array.isArray(embedding) ? embedding.length : typeof embedding} dims, expected ${OPENAI_EMBEDDING_DIMS}`,
      );
      return null;
    }

    return embedding;
  } catch (err) {
    console.warn("[embeddings] OpenAI call failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

interface OllamaEmbedResponse {
  model: string;
  // `/api/embed` (newer, Ollama 0.2+) — `embeddings` is an array of vectors.
  embeddings?: number[][];
  // `/api/embeddings` (legacy) — `embedding` is a single vector.
  embedding?: number[];
}

/**
 * Get an embedding from a local Ollama server (e.g. qwen3-embedding:8b, 4096 dims).
 *
 * Tries the newer `/api/embed` endpoint first (Ollama 0.2+). Returns null on
 * unreachable Ollama, model not pulled, or malformed response — caller falls
 * back to pg_trgm.
 *
 * Pull the model before first use:
 *   ollama pull qwen3-embedding:8b
 */
async function getOllamaEmbedding(text: string): Promise<number[] | null> {
  const host = (process.env.STAPLER_OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST).replace(/\/+$/, "");
  const model = process.env.STAPLER_OLLAMA_EMBEDDING_MODEL ?? DEFAULT_OLLAMA_EMBEDDING_MODEL;

  try {
    const response = await fetch(`${host}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn(
        `[embeddings] Ollama ${response.status} ${response.statusText} (model=${model}): ${body.slice(0, 200)}`,
      );
      return null;
    }

    const data = (await response.json()) as OllamaEmbedResponse;
    // `/api/embed` returns { embeddings: [[...]] }; legacy returns { embedding: [...] }.
    const embedding = Array.isArray(data?.embeddings?.[0])
      ? data.embeddings[0]
      : Array.isArray(data?.embedding)
        ? data.embedding
        : null;

    if (!embedding || embedding.length === 0) {
      console.warn(`[embeddings] Ollama returned empty embedding (model=${model})`);
      return null;
    }

    return embedding;
  } catch (err) {
    console.warn(
      `[embeddings] Ollama call failed (host=${host}, model=${model}):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Get an embedding vector for the given text from the configured provider.
 *
 * Returns null when:
 * - No provider is configured / reachable (graceful → pg_trgm fallback)
 * - The provider call fails (network, rate limit, missing model, etc.)
 * - The response shape is unexpected
 *
 * Never throws — all errors become warnings so search always has a fallback.
 */
export async function getEmbedding(text: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const provider = getProvider();
  return provider === "ollama" ? getOllamaEmbedding(trimmed) : getOpenAIEmbedding(trimmed);
}

/**
 * Cosine similarity between two vectors of equal length.
 * Returns a value in [−1, 1]; 1 = identical direction, 0 = orthogonal.
 * Returns 0 if either vector is zero-magnitude or lengths differ.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Minimum cosine similarity required to adopt a neighbour's tags during
 * auto-tagging. 0.65 suits text-embedding-3-small; qwen3-embedding clusters
 * slightly differently — if you see too many or too few auto-tag hits, tune
 * via STAPLER_AUTO_TAG_THRESHOLD.
 */
export function getAutoTagThreshold(): number {
  const raw = process.env.STAPLER_AUTO_TAG_THRESHOLD;
  if (raw) {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  }
  return 0.65;
}

/**
 * Given a list of candidates that each carry an embedding and a tags array,
 * find the one most similar to `queryEmbedding` and return its tags if
 * similarity ≥ `threshold`. Returns an empty array when no candidate
 * exceeds the threshold (no tag suggestion).
 *
 * Used for post-save auto-tagging: the caller fetches tagged neighbours
 * from the DB and passes them here; the function is pure and testable.
 */
export function findBestTagsFromCandidates(
  candidates: Array<{ embedding: number[] | null; tags: string[] }>,
  queryEmbedding: number[],
  threshold = getAutoTagThreshold(),
): string[] {
  // Sentinel: -Infinity (not 0) since cosine similarity ranges over [-1, 1];
  // a candidate at -0.3 is still a better match than no candidate, and using
  // 0 as sentinel would silently ignore any all-negative candidate set.
  let bestScore = -Infinity;
  let bestTags: string[] = [];

  for (const c of candidates) {
    if (!Array.isArray(c.embedding) || c.embedding.length !== queryEmbedding.length) continue;
    const score = cosineSimilarity(queryEmbedding, c.embedding);
    if (score > bestScore) {
      bestScore = score;
      bestTags = c.tags;
    }
  }

  return bestScore >= threshold ? bestTags : [];
}
