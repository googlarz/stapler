/**
 * instance-skills.ts
 *
 * Instance-level skill registry — a single shared set of skills for the entire
 * Stapler instance, with no per-company scoping.
 *
 * Skills are stored in the `instance_skills` table and are available to every
 * agent/company. They are invokable via slash commands (/skill-name) in issue
 * threads and are injected into adapters via `listRuntimeSkillEntries`.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import type { Db } from "@stapler/db";
import { instanceSkills } from "@stapler/db";
import type { PaperclipSkillEntry } from "@stapler/adapter-utils/server-utils";
import { unprocessable } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";
import {
  parseSkillImportSourceInput,
  readLocalSkillImports,
  readUrlSkillImports,
  buildSkillRuntimeName,
  deriveCanonicalSkillKey,
} from "./company-skills.js";

// Sentinel used in place of companyId for instance-scoped file paths.
// resolves to <instanceRoot>/skills/__instance__/
const INSTANCE_SENTINEL = "__instance__";

type InstanceSkillRow = typeof instanceSkills.$inferSelect;

export type InstanceSkill = {
  id: string;
  key: string;
  slug: string;
  name: string;
  description: string | null;
  markdown: string;
  sourceType: string;
  sourceLocator: string | null;
  sourceRef: string | null;
  trustLevel: string;
  compatibility: string;
  fileInventory: Array<Record<string, unknown>>;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type InstanceSkillImportResult = {
  imported: Array<{ skill: InstanceSkill; action: "created" | "updated" }>;
  warnings: string[];
};

function toInstanceSkill(row: InstanceSkillRow): InstanceSkill {
  return {
    id: row.id,
    key: row.key,
    slug: row.slug,
    name: row.name,
    description: row.description,
    markdown: row.markdown,
    sourceType: row.sourceType,
    sourceLocator: row.sourceLocator,
    sourceRef: row.sourceRef,
    trustLevel: row.trustLevel,
    compatibility: row.compatibility,
    fileInventory: (row.fileInventory ?? []) as Array<Record<string, unknown>>,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Root directory for instance-level materialized skill files. */
function resolveInstanceSkillsRoot(): string {
  return path.resolve(resolvePaperclipInstanceRoot(), "skills", INSTANCE_SENTINEL);
}

function resolveRuntimeSkillPath(skill: InstanceSkill): string {
  const runtimeRoot = path.resolve(resolveInstanceSkillsRoot(), "__runtime__");
  return path.resolve(runtimeRoot, buildSkillRuntimeName(skill.key, skill.slug));
}

async function materializeSkillFiles(skill: InstanceSkill): Promise<string | null> {
  try {
    const skillDir = resolveRuntimeSkillPath(skill);
    // Write into a temp directory first so active runs that already have symlinks
    // into `skillDir` are never exposed to a partially-written or missing directory.
    // Once all files are ready, atomically swap the temp dir into place.
    const tmpDir = `${skillDir}.tmp-${Date.now()}`;
    await fs.mkdir(tmpDir, { recursive: true });
    // Write SKILL.md from the stored markdown.
    await fs.writeFile(path.resolve(tmpDir, "SKILL.md"), skill.markdown, "utf8");
    // Write any additional files from the inventory (stored inline in markdown for now).
    // For full_execution skills imported from disk, sourceLocator points to the real dir.
    if (skill.sourceLocator) {
      try {
        const srcStat = await fs.stat(skill.sourceLocator);
        if (srcStat.isDirectory()) {
          for (const entry of skill.fileInventory) {
            const relPath = typeof entry.path === "string" ? entry.path : null;
            if (!relPath || relPath === "SKILL.md") continue;
            const src = path.resolve(skill.sourceLocator, relPath);
            const dst = path.resolve(tmpDir, relPath);
            await fs.mkdir(path.dirname(dst), { recursive: true });
            await fs.copyFile(src, dst).catch(() => undefined);
          }
        }
      } catch { /* sourceLocator doesn't exist — markdown-only is fine */ }
    }
    // Swap: rename tmp → final. On Linux/macOS rename(2) is atomic so any concurrent
    // reader either sees the old directory intact or the fully-written new one.
    // fs.rename replaces a non-empty directory only on some platforms, so we
    // remove the old directory first if it exists, keeping the window minimal.
    await fs.rm(skillDir, { recursive: true, force: true });
    await fs.rename(tmpDir, skillDir);
    return skillDir;
  } catch (err) {
    logger.warn({ err, skillKey: skill.key }, "materializeSkillFiles failed");
    return null;
  }
}

export function instanceSkillService(db: Db) {
  async function list(): Promise<InstanceSkill[]> {
    const rows = await db
      .select()
      .from(instanceSkills)
      .orderBy(asc(instanceSkills.name), asc(instanceSkills.key));
    return rows.map(toInstanceSkill);
  }

  async function getById(id: string): Promise<InstanceSkill | null> {
    const row = await db
      .select()
      .from(instanceSkills)
      .where(eq(instanceSkills.id, id))
      .then((rows) => rows[0] ?? null);
    return row ? toInstanceSkill(row) : null;
  }

  async function getByKey(key: string): Promise<InstanceSkill | null> {
    const row = await db
      .select()
      .from(instanceSkills)
      .where(eq(instanceSkills.key, key))
      .then((rows) => rows[0] ?? null);
    return row ? toInstanceSkill(row) : null;
  }

  async function upsertSkill(input: {
    key: string;
    slug: string;
    name: string;
    description: string | null;
    markdown: string;
    sourceType: string;
    sourceLocator: string | null;
    sourceRef: string | null;
    trustLevel: string;
    compatibility: string;
    fileInventory: Array<Record<string, unknown>>;
    metadata: Record<string, unknown> | null;
  }): Promise<{ skill: InstanceSkill; action: "created" | "updated" }> {
    // Wrap the read-then-write in a transaction to prevent the TOCTOU race
    // between concurrent imports of the same skill key.
    const result = await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(instanceSkills)
        .where(eq(instanceSkills.key, input.key))
        .then((rows) => (rows[0] ? toInstanceSkill(rows[0]) : null));

      const now = new Date();

      if (existing) {
        await tx
          .update(instanceSkills)
          .set({
            slug: input.slug,
            name: input.name,
            description: input.description,
            markdown: input.markdown,
            sourceType: input.sourceType,
            sourceLocator: input.sourceLocator,
            sourceRef: input.sourceRef,
            trustLevel: input.trustLevel,
            compatibility: input.compatibility,
            fileInventory: input.fileInventory,
            metadata: input.metadata,
            updatedAt: now,
          })
          .where(eq(instanceSkills.id, existing.id));
        const updated = await tx
          .select()
          .from(instanceSkills)
          .where(eq(instanceSkills.id, existing.id))
          .then((rows) => (rows[0] ? toInstanceSkill(rows[0]) : existing));
        return { skill: updated, action: "updated" as const, previous: existing };
      }

      const [row] = await tx
        .insert(instanceSkills)
        .values({
          key: input.key,
          slug: input.slug,
          name: input.name,
          description: input.description,
          markdown: input.markdown,
          sourceType: input.sourceType,
          sourceLocator: input.sourceLocator,
          sourceRef: input.sourceRef,
          trustLevel: input.trustLevel,
          compatibility: input.compatibility,
          fileInventory: input.fileInventory,
          metadata: input.metadata ?? null,
        })
        .returning();
      return { skill: toInstanceSkill(row!), action: "created" as const, previous: null };
    });

    // Invalidate stale on-disk content outside the transaction so the next
    // heartbeat re-materializes with fresh markdown. Rename rather than rm so
    // active runs that hold open file descriptors into the old directory are
    // not suddenly exposed to a missing path mid-run.
    if (result.action === "updated" && result.previous) {
      const stale = resolveRuntimeSkillPath(result.previous);
      const staleMoved = `${stale}.stale-${Date.now()}`;
      await fs.rename(stale, staleMoved).catch(() => undefined);
      await fs.rm(staleMoved, { recursive: true, force: true }).catch(() => undefined);
    }

    return { skill: result.skill, action: result.action };
  }

  async function importFromSource(source: string): Promise<InstanceSkillImportResult> {
    const parsed = parseSkillImportSourceInput(source);
    const isLocal = !/^https?:\/\//i.test(parsed.resolvedSource);

    const { skills, warnings } = isLocal
      ? {
          skills: (await readLocalSkillImports(INSTANCE_SENTINEL, parsed.resolvedSource)).filter(
            (s) => !parsed.requestedSkillSlug || s.slug === parsed.requestedSkillSlug,
          ),
          warnings: parsed.warnings,
        }
      : await readUrlSkillImports(INSTANCE_SENTINEL, parsed.resolvedSource, parsed.requestedSkillSlug).then(
          (r) => ({ skills: r.skills, warnings: [...parsed.warnings, ...r.warnings] }),
        );

    const filtered = parsed.requestedSkillSlug
      ? skills.filter((s) => s.slug === parsed.requestedSkillSlug)
      : skills;

    if (filtered.length === 0) {
      throw unprocessable(
        parsed.requestedSkillSlug
          ? `Skill "${parsed.requestedSkillSlug}" was not found in the provided source.`
          : "No skills were found in the provided source.",
      );
    }

    // For skills imported via skills.sh, override sourceType.
    if (parsed.originalSkillsShUrl) {
      for (const s of filtered) {
        s.sourceType = "skills_sh";
        s.sourceLocator = parsed.originalSkillsShUrl;
        if (s.metadata) (s.metadata as Record<string, unknown>).sourceKind = "skills_sh";
        s.key = deriveCanonicalSkillKey(INSTANCE_SENTINEL, s);
      }
    }

    const imported: InstanceSkillImportResult["imported"] = [];
    for (const s of filtered) {
      const result = await upsertSkill({
        key: s.key,
        slug: s.slug,
        name: s.name,
        description: s.description,
        markdown: s.markdown,
        sourceType: s.sourceType,
        sourceLocator: s.sourceLocator,
        sourceRef: s.sourceRef,
        trustLevel: s.trustLevel,
        compatibility: s.compatibility,
        fileInventory: s.fileInventory as unknown as Array<Record<string, unknown>>,
        metadata: s.metadata,
      });
      imported.push(result);
    }

    return { imported, warnings };
  }

  async function deleteSkill(id: string): Promise<InstanceSkill | null> {
    const skill = await getById(id);
    if (!skill) return null;

    await db.delete(instanceSkills).where(eq(instanceSkills.id, id));

    // Clean up materialized runtime files.
    await fs.rm(resolveRuntimeSkillPath(skill), { recursive: true, force: true }).catch(() => undefined);

    return skill;
  }

  async function updateSkill(
    id: string,
    patch: Partial<Pick<InstanceSkill, "name" | "description" | "markdown">>,
  ): Promise<InstanceSkill | null> {
    const skill = await getById(id);
    if (!skill) return null;

    await db
      .update(instanceSkills)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(instanceSkills.id, id));

    // Invalidate the on-disk materialized directory so the next heartbeat
    // picks up the freshly written markdown instead of serving stale content.
    // Rename first so active runs with open file descriptors into this directory
    // aren't suddenly reading from a deleted path mid-execution.
    const stale = resolveRuntimeSkillPath(skill);
    const staleMoved = `${stale}.stale-${Date.now()}`;
    await fs.rename(stale, staleMoved).catch(() => undefined);
    await fs.rm(staleMoved, { recursive: true, force: true }).catch(() => undefined);

    return getById(id);
  }

  /**
   * Returns runtime skill entries for adapter ambient injection.
   * Each entry points to a directory containing at minimum a SKILL.md file,
   * materialized from the stored markdown on demand.
   */
  async function listRuntimeSkillEntries(): Promise<PaperclipSkillEntry[]> {
    const rows = await db
      .select()
      .from(instanceSkills)
      .orderBy(asc(instanceSkills.name), asc(instanceSkills.key));
    const skills = rows.map(toInstanceSkill);

    const out: PaperclipSkillEntry[] = [];
    for (const skill of skills) {
      // Check if already materialized on disk.
      const expectedPath = resolveRuntimeSkillPath(skill);
      let source: string | null = null;
      try {
        await fs.access(path.resolve(expectedPath, "SKILL.md"));
        source = expectedPath;
      } catch {
        source = await materializeSkillFiles(skill);
      }

      if (!source) continue;

      out.push({
        key: skill.key,
        runtimeName: buildSkillRuntimeName(skill.key, skill.slug),
        source,
        required: false,
        requiredReason: null,
      });
    }

    out.sort((a, b) => a.key.localeCompare(b.key));
    return out;
  }

  return {
    list,
    getById,
    getByKey,
    importFromSource,
    deleteSkill,
    updateSkill,
    listRuntimeSkillEntries,
  };
}
