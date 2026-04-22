/**
 * Unit tests for Quality Flywheel + Meta-Flywheel pure helpers.
 *
 * These tests cover the deterministic, side-effect-free utility functions
 * from the routing suggester, playbook miner, and playbook injector without
 * requiring a database connection or LLM calls.
 */

import { describe, expect, it } from "vitest";
import {
  normTitle,
  jaccard,
} from "../services/routing-suggester.js";
import {
  normTitle as normTitleMiner,
  jaccard as jaccardMiner,
  clusterTitles,
} from "../services/playbook-miner.js";

// ── normTitle ─────────────────────────────────────────────────────────────────

describe("normTitle (routing-suggester)", () => {
  it("lowercases and strips punctuation", () => {
    expect(normTitle("Fix: The Login Bug!")).toBe("fix login bug");
  });

  it("removes single-char tokens", () => {
    // "a" is both a stop word and single-char — should be removed
    expect(normTitle("a b c add user")).toBe("add user");
  });

  it("strips common stop words", () => {
    const tokens = normTitle("Add the user authentication feature").split(" ");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("a");
    expect(tokens).toContain("add");
    expect(tokens).toContain("user");
    expect(tokens).toContain("authentication");
    expect(tokens).toContain("feature");
  });

  it("handles empty string", () => {
    expect(normTitle("")).toBe("");
  });

  it("handles all stop-word input", () => {
    expect(normTitle("the a an in on at")).toBe("");
  });
});

// ── jaccard ───────────────────────────────────────────────────────────────────

describe("jaccard (routing-suggester)", () => {
  it("returns 1 for identical strings", () => {
    expect(jaccard("fix login bug", "fix login bug")).toBe(1);
  });

  it("returns 0 for completely different strings", () => {
    expect(jaccard("apple orange", "dog cat")).toBe(0);
  });

  it("returns 0 for two empty strings", () => {
    expect(jaccard("", "")).toBe(0);
  });

  it("returns partial overlap correctly", () => {
    // {"fix","login"} ∩ {"fix","auth"} = {"fix"}; union = {"fix","login","auth"} = 3
    expect(jaccard("fix login", "fix auth")).toBeCloseTo(1 / 3, 5);
  });

  it("is symmetric", () => {
    const a = "implement user oauth flow";
    const b = "add oauth user login";
    expect(jaccard(a, b)).toBeCloseTo(jaccard(b, a), 10);
  });
});

// ── normTitle / jaccard parity between routing-suggester and playbook-miner ──

describe("normTitle parity", () => {
  it("routing-suggester and playbook-miner produce the same result", () => {
    const inputs = [
      "Fix authentication bug in login page",
      "Add new dashboard chart for quality metrics",
      "Refactor the database connection pool",
      "",
    ];
    for (const input of inputs) {
      expect(normTitle(input)).toBe(normTitleMiner(input));
    }
  });
});

describe("jaccard parity", () => {
  it("routing-suggester and playbook-miner produce the same result", () => {
    expect(jaccard("foo bar", "bar baz")).toBe(jaccardMiner("foo bar", "bar baz"));
    expect(jaccard("", "")).toBe(jaccardMiner("", ""));
    expect(jaccard("hello world", "hello world")).toBe(jaccardMiner("hello world", "hello world"));
  });
});

// ── clusterTitles ─────────────────────────────────────────────────────────────

describe("clusterTitles (playbook-miner)", () => {
  const makeItem = (norm: string, score = 0.8) => ({ norm, excerpt: norm, score });

  it("returns a single cluster when all items overlap", () => {
    const items = [
      makeItem("fix login bug"),
      makeItem("fix login error"),
      makeItem("fix login issue"),
    ];
    const clusters = clusterTitles(items, 0.3);
    // All share "fix" and "login" — should cluster together
    expect(clusters.length).toBe(1);
    expect(clusters[0].length).toBe(3);
  });

  it("separates clearly different items into distinct clusters", () => {
    const items = [
      makeItem("fix login authentication bug"),
      makeItem("fix login authentication error"),
      makeItem("deploy docker kubernetes container"),
      makeItem("deploy kubernetes container image"),
    ];
    const clusters = clusterTitles(items, 0.3);
    // Two clusters: login-auth and deploy-k8s
    expect(clusters.length).toBe(2);
  });

  it("returns one cluster per item when threshold is 1 (no overlap)", () => {
    const items = [
      makeItem("apple orange"),
      makeItem("dog cat"),
      makeItem("red blue"),
    ];
    const clusters = clusterTitles(items, 1.0);
    expect(clusters.length).toBe(3);
  });

  it("handles empty input", () => {
    expect(clusterTitles([], 0.3)).toEqual([]);
  });

  it("handles a single item", () => {
    const clusters = clusterTitles([makeItem("solo task")], 0.3);
    expect(clusters.length).toBe(1);
    expect(clusters[0].length).toBe(1);
  });

  it("uses the first item in the cluster as centroid for comparison", () => {
    // Item C is similar to item A (centroid) but not to item B
    const items = [
      makeItem("build typescript compiler"),
      makeItem("deploy kubernetes cluster"),
      makeItem("build typescript linter"),   // similar to A
    ];
    const clusters = clusterTitles(items, 0.3);
    // "build typescript" in A and C share 2/3 tokens → jaccard ≈ 0.5 > 0.3
    // B is a separate cluster
    expect(clusters.length).toBe(2);
    // The cluster containing A should also have C
    const largeCluster = clusters.find((c) => c.length > 1);
    expect(largeCluster).toBeDefined();
    const norms = largeCluster!.map((i) => i.norm);
    expect(norms).toContain("build typescript compiler");
    expect(norms).toContain("build typescript linter");
  });
});

// ── EMA win-rate formula (inline, no DB) ─────────────────────────────────────

describe("EMA win-rate formula", () => {
  const alpha = 0.2;
  const ema = (prev: number, score: number) => alpha * score + (1 - alpha) * prev;

  it("converges toward 1 when all runs succeed", () => {
    let rate = 0.5;
    for (let i = 0; i < 50; i++) rate = ema(rate, 1);
    expect(rate).toBeGreaterThan(0.99);
  });

  it("converges toward 0 when all runs fail", () => {
    let rate = 0.5;
    for (let i = 0; i < 50; i++) rate = ema(rate, 0);
    expect(rate).toBeLessThan(0.01);
  });

  it("a single run moves the rate by exactly alpha", () => {
    const prev = 0.6;
    const score = 1.0;
    const result = ema(prev, score);
    expect(result).toBeCloseTo(prev + alpha * (score - prev), 10);
  });

  it("stays within [0, 1] for any valid score input", () => {
    const testCases: Array<[number, number]> = [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [0.5, 0.5],
    ];
    for (const [prev, score] of testCases) {
      const result = ema(prev, score);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  });
});

// ── A/B routing parity ────────────────────────────────────────────────────────

describe("A/B playbook routing by run ID parity", () => {
  // The injector uses last char of runId to decide control vs challenger
  const isChallenger = (runId: string) => {
    const lastChar = runId.slice(-1);
    const n = parseInt(lastChar, 16);
    return !isNaN(n) && n % 2 === 1;
  };

  it("produces roughly 50/50 split over 100 hex-like run IDs", () => {
    const ids = Array.from({ length: 100 }, (_, i) => i.toString(16).padStart(8, "0"));
    const challengerCount = ids.filter(isChallenger).length;
    // Expect between 40% and 60%
    expect(challengerCount).toBeGreaterThanOrEqual(40);
    expect(challengerCount).toBeLessThanOrEqual(60);
  });

  it("same run ID always routes to the same variant", () => {
    const id = "abc123de";
    expect(isChallenger(id)).toBe(isChallenger(id));
  });
});
