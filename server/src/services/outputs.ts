import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@stapler/db";
import { outputs, outputVersions } from "@stapler/db";

export function outputService(db: Db) {
  return {
    list: (companyId: string) =>
      db
        .select()
        .from(outputs)
        .where(eq(outputs.companyId, companyId))
        .orderBy(desc(outputs.createdAt)),

    getById: (id: string) =>
      db
        .select()
        .from(outputs)
        .where(eq(outputs.id, id))
        .then((rows) => rows[0] ?? null),

    getVersions: (outputId: string) =>
      db
        .select()
        .from(outputVersions)
        .where(eq(outputVersions.outputId, outputId))
        .orderBy(asc(outputVersions.versionNumber)),

    create: (
      companyId: string,
      data: { title: string; description?: string; proposedByAgentId?: string },
    ) =>
      db
        .insert(outputs)
        .values({ companyId, ...data })
        .returning()
        .then((rows) => rows[0]),

    update: (id: string, data: Partial<typeof outputs.$inferInsert>) =>
      db
        .update(outputs)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(outputs.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    updateDraft: (id: string, draftContent: string) =>
      db
        .update(outputs)
        .set({ draftContent, updatedAt: new Date() })
        .where(eq(outputs.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    approve: (id: string, approvedByAgentId: string) =>
      db
        .update(outputs)
        .set({ status: "active", approvedByAgentId, updatedAt: new Date() })
        .where(eq(outputs.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    /**
     * Snapshot the current draft as a new immutable version and increment
     * `latestVersionNumber`. Returns the new version record.
     */
    releaseVersion: async (
      id: string,
      data: { releasedByAgentId?: string; releaseNotes?: string },
    ) => {
      const output = await db
        .select()
        .from(outputs)
        .where(eq(outputs.id, id))
        .then((rows) => rows[0] ?? null);

      if (!output) return null;

      const nextVersion = output.latestVersionNumber + 1;

      const [version] = await db
        .insert(outputVersions)
        .values({
          outputId: id,
          versionNumber: nextVersion,
          content: output.draftContent,
          releasedByAgentId: data.releasedByAgentId ?? null,
          releaseNotes: data.releaseNotes ?? null,
        })
        .returning();

      const now = new Date();
      await db
        .update(outputs)
        .set({ latestVersionNumber: nextVersion, latestVersionReleasedAt: now, updatedAt: now })
        .where(eq(outputs.id, id));

      return version;
    },

    remove: (id: string) =>
      db
        .delete(outputs)
        .where(eq(outputs.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),
  };
}
