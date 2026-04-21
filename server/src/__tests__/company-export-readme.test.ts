/**
 * Tests for company export README generation utilities.
 */
import { describe, expect, it } from "vitest";
import {
  generateOrgChartMermaid,
  generateReadme,
} from "../services/company-export-readme.ts";

const baseAgent = {
  slug: "alice-eng",
  name: "Alice",
  role: "engineer",
  reportsToSlug: null,
  adapterType: "claude_local",
  description: null,
};

// ──────────────────────────────────────────────────────────
// generateOrgChartMermaid
// ──────────────────────────────────────────────────────────

describe("generateOrgChartMermaid", () => {
  it("returns null for empty agents list", () => {
    expect(generateOrgChartMermaid([])).toBeNull();
  });

  it("wraps output in mermaid code fence", () => {
    const result = generateOrgChartMermaid([baseAgent]);
    expect(result).toContain("```mermaid");
    expect(result).toContain("graph TD");
    expect(result).toContain("```");
  });

  it("includes agent node with name and role", () => {
    const result = generateOrgChartMermaid([baseAgent]);
    expect(result).toContain("Alice");
    expect(result).toContain("Engineer");
  });

  it("includes edge from parent to child", () => {
    const ceo = { ...baseAgent, slug: "bob-ceo", name: "Bob", role: "ceo", reportsToSlug: null };
    const report = { ...baseAgent, slug: "alice-eng", name: "Alice", role: "engineer", reportsToSlug: "bob-ceo" };
    const result = generateOrgChartMermaid([ceo, report])!;
    expect(result).toContain("bob_ceo --> alice_eng");
  });

  it("does not add edge for reportsToSlug that is not in the agent list", () => {
    const orphan = { ...baseAgent, reportsToSlug: "nonexistent-boss" };
    const result = generateOrgChartMermaid([orphan])!;
    expect(result).not.toContain("-->");
  });

  it("sanitizes slugs with hyphens for Mermaid IDs", () => {
    const result = generateOrgChartMermaid([{ ...baseAgent, slug: "my-agent-slug" }])!;
    expect(result).toContain("my_agent_slug");
  });

  it("escapes double quotes in agent names", () => {
    const weirdAgent = { ...baseAgent, name: 'Say "hello"' };
    const result = generateOrgChartMermaid([weirdAgent])!;
    expect(result).toContain("&quot;");
    expect(result).not.toContain('"hello"');
  });

  it("uses role key verbatim when not in ROLE_LABELS", () => {
    const customAgent = { ...baseAgent, role: "ninja" };
    const result = generateOrgChartMermaid([customAgent])!;
    expect(result).toContain("ninja");
  });
});

// ──────────────────────────────────────────────────────────
// generateReadme
// ──────────────────────────────────────────────────────────

const emptyManifest = {
  agents: [],
  projects: [],
  skills: [],
  issues: [],
  routines: [],
  documents: [],
  goals: [],
};

describe("generateReadme", () => {
  const opts = { companyName: "Acme AI", companyDescription: null };

  it("includes the company name as H1", () => {
    const readme = generateReadme(emptyManifest, opts);
    expect(readme).toContain("# Acme AI");
  });

  it("includes Getting Started section", () => {
    const readme = generateReadme(emptyManifest, opts);
    expect(readme).toContain("## Getting Started");
    expect(readme).toContain("pnpm stapler company import");
  });

  it("includes company description when provided", () => {
    const readme = generateReadme(emptyManifest, {
      ...opts,
      companyDescription: "The best AI company",
    });
    expect(readme).toContain("> The best AI company");
  });

  it("omits description block when description is null", () => {
    const readme = generateReadme(emptyManifest, opts);
    // The readme should not contain a blockquote description line
    // (it will still contain "> This is an Agent Company" from What's Inside)
    expect(readme).not.toMatch(/^> (?!This is)/m);
  });

  it("includes org chart image placeholder when agents exist", () => {
    const manifest = { ...emptyManifest, agents: [baseAgent] };
    const readme = generateReadme(manifest, opts);
    expect(readme).toContain("![Org Chart](images/org-chart.png)");
  });

  it("omits org chart image when no agents", () => {
    const readme = generateReadme(emptyManifest, opts);
    expect(readme).not.toContain("Org Chart");
  });

  it("includes agent table when agents exist", () => {
    const manifest = { ...emptyManifest, agents: [baseAgent] };
    const readme = generateReadme(manifest, opts);
    expect(readme).toContain("### Agents");
    expect(readme).toContain("Alice");
    expect(readme).toContain("Engineer");
  });

  it("includes projects list when projects exist", () => {
    const manifest = {
      ...emptyManifest,
      projects: [{ name: "Project Alpha", description: "Initial phase", status: "active" }],
    };
    const readme = generateReadme(manifest, opts);
    expect(readme).toContain("### Projects");
    expect(readme).toContain("Project Alpha");
    expect(readme).toContain("Initial phase");
  });

  it("includes skills table when skills exist", () => {
    const manifest = {
      ...emptyManifest,
      skills: [{ name: "Code Review", description: "Review code", sourceType: "local", sourceLocator: null }],
    };
    const readme = generateReadme(manifest, opts);
    expect(readme).toContain("### Skills");
    expect(readme).toContain("Code Review");
  });

  it("includes What's Inside table with counts", () => {
    const manifest = { ...emptyManifest, agents: [baseAgent] };
    const readme = generateReadme(manifest, opts);
    expect(readme).toContain("## What's Inside");
    expect(readme).toContain("| Agents | 1 |");
  });

  it("does not include empty sections in What's Inside table", () => {
    const readme = generateReadme(emptyManifest, opts);
    // Should not contain table when everything is empty
    expect(readme).not.toContain("| Content | Count |");
  });

  it("includes export footer with date", () => {
    const readme = generateReadme(emptyManifest, opts);
    const today = new Date().toISOString().split("T")[0];
    expect(readme).toContain(`Exported from`);
    expect(readme).toContain(today);
  });
});
