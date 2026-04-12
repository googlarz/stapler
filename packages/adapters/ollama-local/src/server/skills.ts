import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdapterSkillContext,
  AdapterSkillEntry,
  AdapterSkillSnapshot,
} from "@paperclipai/adapter-utils";
import {
  readPaperclipRuntimeSkillEntries,
  resolvePaperclipDesiredSkillNames,
} from "@paperclipai/adapter-utils/server-utils";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

async function buildOllamaSkillSnapshot(config: Record<string, unknown>): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredSkills = resolvePaperclipDesiredSkillNames(config, availableEntries);
  const desiredSet = new Set(desiredSkills);

  const entries: AdapterSkillEntry[] = availableEntries.map((entry) => ({
    key: entry.key,
    runtimeName: entry.runtimeName,
    desired: desiredSet.has(entry.key),
    managed: true,
    state: desiredSet.has(entry.key) ? "configured" : "available",
    origin: entry.required ? "paperclip_required" : "company_managed",
    originLabel: entry.required ? "Required by Paperclip" : "Managed by Paperclip",
    readOnly: false,
    sourcePath: entry.source,
    targetPath: null,
    detail: desiredSet.has(entry.key)
      ? "Will be injected into the system prompt on the next run."
      : null,
    required: Boolean(entry.required),
    requiredReason: entry.requiredReason ?? null,
  }));

  const warnings: string[] = [];
  const availableByKey = new Map(availableEntries.map((e) => [e.key, e]));
  for (const desiredSkill of desiredSkills) {
    if (!availableByKey.has(desiredSkill)) {
      warnings.push(`Desired skill "${desiredSkill}" is not available from the Paperclip skills directory.`);
      entries.push({
        key: desiredSkill,
        runtimeName: null,
        desired: true,
        managed: true,
        state: "missing",
        origin: "external_unknown",
        originLabel: "External or unavailable",
        readOnly: false,
        sourcePath: undefined,
        targetPath: undefined,
        detail: "Paperclip cannot find this skill in the local runtime skills directory.",
      });
    }
  }

  entries.sort((a, b) => a.key.localeCompare(b.key));

  return {
    adapterType: "ollama_local",
    supported: true,
    mode: "ephemeral",
    desiredSkills,
    entries,
    warnings,
  };
}

export async function listOllamaSkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
  return buildOllamaSkillSnapshot(ctx.config);
}

export async function syncOllamaSkills(
  ctx: AdapterSkillContext,
  _desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  return buildOllamaSkillSnapshot(ctx.config);
}

export function resolveOllamaDesiredSkillNames(
  config: Record<string, unknown>,
  availableEntries: Array<{ key: string; required?: boolean }>,
): string[] {
  return resolvePaperclipDesiredSkillNames(config, availableEntries);
}
