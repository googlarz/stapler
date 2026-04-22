/**
 * Decomposition evaluator — Pillar 6 of the Meta-Flywheel.
 *
 * Tracks each goal decomposition in `decomposition_outcomes`:
 *  - seedDecompositionOutcome(): called at decompose time; seeds the row
 *  - finalizeDecompositionOutcome(): called when goal is achieved/failed;
 *    aggregates child-issue run scores and marks the outcome
 *
 * Also provides `getPastDecompositions()` for RAG-augmented decomposition
 * (used by goal-decomposer to inject successful decomposition examples).
 */

import { and, avg, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@stapler/db";
import { decompositionOutcomes, issues, runScores } from "@stapler/db";

/** Normalise a goal title for lightweight similarity matching */
function normTitle(title: string): string {
  const STOP = new Set(["the","a","an","in","on","at","for","to","of","and","or","is","are","be","was","with","from","that","this","by","as","it"]);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .join(" ");
}

/**
 * Seed a decomposition_outcomes row right after a goal is decomposed.
 * issueTitles is the list of issue titles that were just created.
 */
export async function seedDecompositionOutcome(
  db: Db,
  goalId: string,
  companyId: string,
  goalTitle: string,
  issueTitles: string[],
): Promise<void> {
  try {
    await db.insert(decompositionOutcomes).values({
      goalId,
      companyId,
      goalTitleNorm: normTitle(goalTitle),
      issueTitles: JSON.stringify(issueTitles),
    });
  } catch {
    // Non-critical
  }
}

/**
 * Finalize a decomposition_outcomes row when the goal is achieved or failed.
 * Aggregates the avg run score across all child issues' run scores.
 */
export async function finalizeDecompositionOutcome(
  db: Db,
  goalId: string,
  companyId: string,
): Promise<void> {
  try {
    // Get all issues for this goal that have run scores
    const scoreRows = await db
      .select({
        avgScore: avg(runScores.score).mapWith(Number),
      })
      .from(runScores)
      .innerJoin(issues, eq(issues.id, runScores.runId))
      .where(
        and(
          eq(issues.goalId, goalId),
          eq(issues.companyId, companyId),
          isNotNull(runScores.score),
        ),
      );

    const outcomeScore = scoreRows[0]?.avgScore ?? null;

    await db
      .update(decompositionOutcomes)
      .set({
        outcomeScore: outcomeScore ?? undefined,
        finalizedAt: new Date(),
      })
      .where(
        and(
          eq(decompositionOutcomes.goalId, goalId),
          eq(decompositionOutcomes.companyId, companyId),
        ),
      );
  } catch {
    // Non-critical
  }
}

export interface PastDecomposition {
  goalTitleNorm: string;
  issueTitles: string[];
  outcomeScore: number;
}

/**
 * Retrieve the top N successful past decompositions for a company,
 * ordered by outcome score descending. Used for RAG-augmented decomposition.
 */
export async function getPastDecompositions(
  db: Db,
  companyId: string,
  limit = 5,
): Promise<PastDecomposition[]> {
  try {
    const rows = await db
      .select({
        goalTitleNorm: decompositionOutcomes.goalTitleNorm,
        issueTitles: decompositionOutcomes.issueTitles,
        outcomeScore: decompositionOutcomes.outcomeScore,
      })
      .from(decompositionOutcomes)
      .where(
        and(
          eq(decompositionOutcomes.companyId, companyId),
          isNotNull(decompositionOutcomes.outcomeScore),
          isNotNull(decompositionOutcomes.finalizedAt),
        ),
      )
      .orderBy(desc(decompositionOutcomes.outcomeScore))
      .limit(limit);

    return rows
      .filter((r) => r.outcomeScore !== null && r.outcomeScore >= 0.6)
      .map((r) => ({
        goalTitleNorm: r.goalTitleNorm ?? "",
        issueTitles: (() => {
          try { return JSON.parse(r.issueTitles) as string[]; } catch { return []; }
        })(),
        outcomeScore: r.outcomeScore!,
      }));
  } catch {
    return [];
  }
}
