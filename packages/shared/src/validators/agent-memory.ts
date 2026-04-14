import { z } from "zod";

/**
 * Hard caps on memory content. These match the server defaults and
 * serve as a first-line client validation. The server re-applies the
 * byte-level check (the `content.length` here counts code units, not
 * bytes, so callers should expect a 413-ish at the server for
 * multibyte-heavy content near the limit).
 */
export const MAX_AGENT_MEMORY_CONTENT_CHARS = 4096;
export const MAX_AGENT_MEMORY_TAGS = 16;
export const MAX_AGENT_MEMORY_TAG_LENGTH = 64;

const tagSchema = z
  .string()
  .trim()
  .min(1, "Tag cannot be empty")
  .max(MAX_AGENT_MEMORY_TAG_LENGTH, `Tag must be at most ${MAX_AGENT_MEMORY_TAG_LENGTH} characters`)
  .regex(/^[a-zA-Z0-9_\-:.]+$/, "Tags may contain letters, digits, '_', '-', ':' and '.'");

export const agentMemoryTagsSchema = z
  .array(tagSchema)
  .max(MAX_AGENT_MEMORY_TAGS, `At most ${MAX_AGENT_MEMORY_TAGS} tags per memory`)
  .transform((tags) => Array.from(new Set(tags)));

export const createAgentMemorySchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "content is required")
    .max(MAX_AGENT_MEMORY_CONTENT_CHARS, `content must be at most ${MAX_AGENT_MEMORY_CONTENT_CHARS} characters`),
  tags: agentMemoryTagsSchema.optional(),
  /**
   * ISO 8601 datetime after which the memory is automatically excluded from
   * searches and run-start injection. Useful for time-scoped notes
   * ("today's sprint focus", "current PR under review"). Must be in the future.
   * Wiki pages ignore this field — they are maintained documents not subject to TTL.
   */
  expiresAt: z
    .string()
    .datetime({ message: "expiresAt must be an ISO 8601 datetime string" })
    .optional(),
});

export type CreateAgentMemoryInput = z.infer<typeof createAgentMemorySchema>;

const limitSchema = z.coerce.number().int().positive().max(100);
const offsetSchema = z.coerce.number().int().min(0).max(10_000);

/**
 * Query for GET /agents/:agentId/memories. `q` triggers trigram search
 * and ranks by similarity; otherwise the list is returned most-recent
 * first. `tags` is a comma-separated list of required tags (AND
 * semantics).
 */
export const listAgentMemoriesQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(512).optional(),
    tags: z
      .string()
      .trim()
      .optional()
      .transform((raw) => {
        if (!raw) return undefined;
        const parts = raw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        return parts.length > 0 ? parts : undefined;
      }),
    limit: limitSchema.optional(),
    offset: offsetSchema.optional(),
  })
  .strict();

export type ListAgentMemoriesQuery = z.infer<typeof listAgentMemoriesQuerySchema>;
