/**
 * Semantic embedding service.
 *
 * Uses OpenAI text-embedding-3-small (1536 dims) to convert text into float32
 * vectors suitable for cosine similarity search. Entirely optional — when
 * OPENAI_API_KEY is not set, all functions gracefully return null / 0.
 *
 * Designed for small-corpus use (Odysseia: ≤5K memories per company). App-side
 * cosine similarity over the full table is sub-millisecond at this scale;
 * no vector index is needed.
 *
 * When pgvector becomes available in embedded-postgres, the embedding column
 * (real[]) can be migrated to vector(1536) and the similarity() call moved
 * to PostgreSQL for even better performance.
 */

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 1536;

/**
 * Cosine similarity threshold below which a candidate is excluded from
 * semantic search results. text-embedding-3-small produces values in
 * [−1, 1]; 0.25 catches semantically related content without too many
 * false positives in German-language corpora.
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
  data: Array<{
    object: "embedding";
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

/**
 * Get a 1536-dim embedding vector for the given text from OpenAI.
 *
 * Returns null when:
 * - OPENAI_API_KEY is not configured (graceful degradation → pg_trgm)
 * - The API call fails for any reason (network error, rate limit, etc.)
 * - The response shape is unexpected
 *
 * Never throws — all errors are logged as warnings and swallowed so the
 * caller can fall back to keyword search.
 */
export async function getEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: trimmed,
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

    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMS) {
      console.warn(
        `[embeddings] Unexpected embedding shape: got ${Array.isArray(embedding) ? embedding.length : typeof embedding} dims, expected ${EMBEDDING_DIMS}`,
      );
      return null;
    }

    return embedding;
  } catch (err) {
    console.warn("[embeddings] Failed to get embedding:", err instanceof Error ? err.message : err);
    return null;
  }
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
 * auto-tagging. 0.65 corresponds roughly to "same topic" with
 * text-embedding-3-small. Override via STAPLER_AUTO_TAG_THRESHOLD.
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
