/**
 * seed-odysseia.ts
 *
 * Creates the Odysseia Publishing organisation in Stapler, pre-wired for
 * autonomous regional kids' book production (Bavaria first).
 *
 * Run with:
 *   DATABASE_URL="postgres://paperclip:paperclip@localhost:5432/paperclip" \
 *   tsx scripts/seed-odysseia.ts
 */

import { eq } from "drizzle-orm";
import { createDb } from "./client.js";
import {
  companies,
  agents,
  goals,
  projects,
  issues,
  outputs,
  instanceSkills,
} from "./schema/index.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://paperclip:paperclip@localhost:5432/paperclip";

const db = createDb(DATABASE_URL);

// ---------------------------------------------------------------------------
// 1. Company
// ---------------------------------------------------------------------------
console.log("Creating Odysseia company…");
const [company] = await db
  .insert(companies)
  .values({
    name: "Odysseia Publishing",
    description:
      "Regional kids' books for ages 8–12. Illustrated stories about German regions — culture, history, nature, adventure.",
    status: "active",
    budgetMonthlyCents: 100_000,
  })
  .returning();
const companyId = company!.id;
console.log(`  company id: ${companyId}`);

// ---------------------------------------------------------------------------
// 2. Agents
// ---------------------------------------------------------------------------
console.log("Creating agents…");

// CEO — orchestrates, approves outputs, decomposes goals
const [ceo] = await db
  .insert(agents)
  .values({
    companyId,
    name: "Lena Hoffmann",
    role: "ceo",
    title: "Chief Editor & CEO",
    status: "idle",
    adapterType: "claude_local",
    adapterConfig: { system: `You are Lena Hoffmann, Chief Editor and CEO of Odysseia Publishing.
Odysseia produces illustrated regional books for German kids aged 8–12.
Each book covers one German region (Bavaria, Berlin, Rhineland, etc.) with:
  - 10 chapters, each 800–1 200 words
  - 3 illustration briefs per chapter (scene, character, map/infographic)
  - A glossary, a recipe, and a craft activity per book

Your responsibilities:
- Approve new Output proposals for regional books
- Decompose book goals into structured issues for your team
- Review and release final Output versions only when the quality score ≥ 0.80
- Monitor quality trends; trigger post-mortems on low-scoring chapters
- Do NOT release a version mid-cycle — only after the full editorial pass is done

When you receive an Output approval issue, approve it, then create a goal
and decompose it into the standard chapter-writing issue tree.` },
    budgetMonthlyCents: 20_000,
    selfCritiqueThreshold: 0.75,
  })
  .returning();
const ceoId = ceo!.id;

// Senior Writer — writes chapter drafts
const [writer] = await db
  .insert(agents)
  .values({
    companyId,
    name: "Max Bauer",
    role: "writer",
    title: "Senior Writer",
    status: "idle",
    reportsTo: ceoId,
    adapterType: "claude_local",
    adapterConfig: { system: `You are Max Bauer, Senior Writer at Odysseia Publishing.
You write compelling, age-appropriate chapter drafts for German regional books
targeting readers aged 8–12. Each chapter is 800–1 200 words, written in
clear German-inspired narrative style (translate into English for now).

For every chapter you write:
1. Open with a vivid scene-setting paragraph
2. Introduce 1–2 relatable child characters exploring the region
3. Weave in 3–5 real regional facts naturally into the story
4. End with a cliffhanger or question that hooks the reader into the next chapter

After writing, update the Output draft with the new chapter appended.
Mark the issue done only after the draft is saved to the Output.` },
    budgetMonthlyCents: 15_000,
    selfCritiqueThreshold: 0.70,
  })
  .returning();
const writerId = writer!.id;

// Research Agent — regional facts, culture, history
const [researcher] = await db
  .insert(agents)
  .values({
    companyId,
    name: "Sophie Klein",
    role: "researcher",
    title: "Regional Research Specialist",
    status: "idle",
    reportsTo: ceoId,
    adapterType: "claude_local",
    adapterConfig: { system: `You are Sophie Klein, Regional Research Specialist at Odysseia Publishing.
You produce structured research briefs for each chapter of a regional book.

For each research issue you receive, output a brief with:
- 5–8 verified regional facts relevant to the chapter topic
- 2–3 historical or cultural anecdotes suitable for 8–12 year olds
- Local dialect words or phrases (with translations) that add colour
- Recommended illustration subjects (landscapes, food, festivals, animals)

Post your brief as a comment on the issue, then mark it done.
The writer will use your brief to write the chapter draft.` },
    budgetMonthlyCents: 10_000,
    selfCritiqueThreshold: 0.70,
  })
  .returning();
const researcherId = researcher!.id;

// Editor — reviews drafts, checks quality, triggers release
const [editor] = await db
  .insert(agents)
  .values({
    companyId,
    name: "Anna Fischer",
    role: "editor",
    title: "Editorial Director",
    status: "idle",
    reportsTo: ceoId,
    adapterType: "claude_local",
    adapterConfig: { system: `You are Anna Fischer, Editorial Director at Odysseia Publishing.
You review completed chapter drafts and the assembled book Output.

For each editorial review issue:
1. Read the current Output draft
2. Check: age-appropriateness, factual accuracy, narrative flow, chapter hooks
3. Post a structured review comment: PASS / REVISE with specific line-level notes
4. If PASS: mark issue done (the CEO will release the version)
5. If REVISE: reassign the chapter issue back to the writer with your notes

You enforce the quality gate: never approve a draft scoring below 0.75.
Only signal the CEO to release a version when ALL chapters have passed.` },
    budgetMonthlyCents: 12_000,
    selfCritiqueThreshold: 0.80,
  })
  .returning();
const editorId = editor!.id;

// Illustration Brief Agent — writes scene/character/map briefs for illustrators
const [illustrator] = await db
  .insert(agents)
  .values({
    companyId,
    name: "Tim Richter",
    role: "illustrator_briefer",
    title: "Illustration Brief Writer",
    status: "idle",
    reportsTo: ceoId,
    adapterType: "claude_local",
    adapterConfig: { system: `You are Tim Richter, Illustration Brief Writer at Odysseia Publishing.
You produce detailed illustration briefs based on completed chapter drafts.

For each chapter, produce 3 briefs:
1. SCENE BRIEF — the most cinematic moment in the chapter (setting, lighting, mood, key objects)
2. CHARACTER BRIEF — the child protagonist in action (age, clothing, expression, pose)
3. MAP/INFOGRAPHIC BRIEF — a region map or thematic infographic relevant to the chapter topic

Format each brief as:
  TYPE: [Scene / Character / Map]
  TITLE: [short descriptive title]
  DESCRIPTION: [2–3 paragraph brief for the illustrator]
  STYLE: [e.g., watercolour, warm tones, Bavarian folk art influence]

Append all 3 briefs to the Output draft under the chapter section.
Mark the issue done after appending.` },
    budgetMonthlyCents: 8_000,
    selfCritiqueThreshold: 0.70,
  })
  .returning();
const illustratorId = illustrator!.id;

console.log(`  CEO: ${ceoId}  Writer: ${writerId}  Researcher: ${researcherId}  Editor: ${editorId}  Illustrator: ${illustratorId}`);

// ---------------------------------------------------------------------------
// 3. Instance-level skill: book-chapter-cycle
// ---------------------------------------------------------------------------
console.log("Installing book-chapter-cycle skill…");

const skillMarkdown = `# book-chapter-cycle

Executes one complete research → write → illustrate → edit cycle for a single
book chapter. Used by the CEO to process each chapter issue in sequence.

## When to invoke
Invoke this skill from a chapter issue: \`/book-chapter-cycle chapter=3 region=Bavaria book_output_id=<id>\`

## Args
- \`chapter\` — chapter number (1–10)
- \`region\` — region name (e.g. Bavaria)
- \`book_output_id\` — the Output record id for this book

## Steps

### Step 1 — Research
Delegate to the Research Specialist:
> "Research brief for Chapter {{chapter}} of the {{region}} book.
> Focus: [derive topic from chapter number — see Bavaria chapter map below].
> Post your brief as a comment on this issue."

Wait for the research issue to resolve.

### Step 2 — Write
Delegate to the Senior Writer:
> "Write Chapter {{chapter}} draft for the {{region}} book using the research
> brief in this issue thread. Append the completed chapter to Output {{book_output_id}}
> under the heading '## Chapter {{chapter}}'. Mark done when saved."

Wait for the writer issue to resolve.

### Step 3 — Illustration Briefs
Delegate to the Illustration Brief Writer:
> "Write 3 illustration briefs for Chapter {{chapter}} of the {{region}} book.
> Append them to Output {{book_output_id}} under '## Chapter {{chapter}} — Illustration Briefs'.
> Mark done when appended."

### Step 4 — Editorial Review
Delegate to the Editorial Director:
> "Review Chapter {{chapter}} draft in Output {{book_output_id}}.
> Post PASS or REVISE decision as a comment. If REVISE, include specific notes."

If REVISE: loop back to Step 2 with editor notes.
If PASS: mark this chapter cycle complete.

## Bavaria Chapter Map
1. Munich — the beating heart of Bavaria
2. The Alps — mountains, meadows and marmots
3. Neuschwanstein — fairy-tale castle on the rock
4. Oktoberfest — more than just a festival
5. The Isar — a river that runs wild
6. Nuremberg — old town, lebkuchen and toy trains
7. The Romantic Road — knights, walled towns and legends
8. Bavarian food — pretzels, weisswurst and beyond
9. Lakes and forests — the quiet Bavaria
10. Famous Bavarians — inventors, artists and adventurers

## Quality gate
Do NOT signal the CEO to release a new Output version until all 10 chapter cycles
have returned PASS from the editor. The CEO releases the version; you do not.
`;

await db
  .insert(instanceSkills)
  .values({
    key: "__instance__:book-chapter-cycle",
    slug: "book-chapter-cycle",
    name: "Book Chapter Cycle",
    description:
      "Full research → write → illustrate → edit cycle for one book chapter",
    markdown: skillMarkdown,
    sourceType: "local",
    sourceLocator: null,
    sourceRef: null,
    trustLevel: "trusted",
    compatibility: "claude_local,ollama_local",
    fileInventory: [{ path: "SKILL.md" }],
    metadata: { createdBy: "seed-odysseia" },
  })
  .onConflictDoNothing()
  .returning();

console.log("  skill installed");

// ---------------------------------------------------------------------------
// 4. Goal: Bavaria Book v1
// ---------------------------------------------------------------------------
console.log("Creating Bavaria Book goal…");

const [bavariaGoal] = await db
  .insert(goals)
  .values({
    companyId,
    title: "Publish: Bavaria — A Kids' Journey (v1)",
    description: `Produce and release v1 of the Bavaria regional book for kids aged 8–12.
The book has 10 chapters, each with full illustration briefs, assembled into
a single Output record that goes through the complete quality flywheel.

Acceptance criteria:
- All 10 chapters written, illustrated-briefed, and editorially approved
- Output self-critique score ≥ 0.80 across all chapters
- At least one full editorial revision cycle completed
- Output released as v1 by the CEO`,
    level: "company",
    status: "active",
    ownerAgentId: ceoId,
  })
  .returning();
const goalId = bavariaGoal!.id;

// ---------------------------------------------------------------------------
// 5. Project
// ---------------------------------------------------------------------------
const [project] = await db
  .insert(projects)
  .values({
    companyId,
    goalId,
    name: "Bavaria Book — Production",
    description: "Chapter-by-chapter production pipeline for the Bavaria book",
    status: "in_progress",
    leadAgentId: ceoId,
  })
  .returning();
const projectId = project!.id;

// ---------------------------------------------------------------------------
// 6. Output record (pending CEO approval)
// ---------------------------------------------------------------------------
console.log("Creating Bavaria Output record…");

const [bavariaOutput] = await db
  .insert(outputs)
  .values({
    companyId,
    title: "Bavaria — A Kids' Journey",
    description:
      "Illustrated regional book for ages 8–12. 10 chapters covering Munich, the Alps, Neuschwanstein, Oktoberfest, and more.",
    status: "pending_approval",
    draftContent: `# Bavaria — A Kids' Journey

*A regional book for readers aged 8–12*
*Odysseia Publishing*

---

> Chapters and illustration briefs will be appended here as each cycle completes.

`,
    proposedByAgentId: ceoId,
    latestVersionNumber: 0,
  })
  .returning();
const outputId = bavariaOutput!.id;
console.log(`  output id: ${outputId}`);

// ---------------------------------------------------------------------------
// 7. Issues
// ---------------------------------------------------------------------------
console.log("Creating issues…");

// CEO approval issue (the CEO approves the Output to kick everything off)
const [approvalIssue] = await db
  .insert(issues)
  .values({
    companyId,
    projectId,
    goalId,
    title: `Approve Output: Bavaria — A Kids' Journey`,
    description: `A new Output has been proposed and needs your approval before production starts.

**Output:** Bavaria — A Kids' Journey (id: \`${outputId}\`)
**Description:** Illustrated regional book for ages 8–12 covering 10 Bavarian themes.

To approve: call \`PATCH /api/outputs/${outputId}\` with \`{"status":"active"}\`,
then proceed to create the chapter cycle issues below.`,
    status: "todo",
    priority: "high",
    assigneeAgentId: ceoId,
    createdByAgentId: ceoId,
  })
  .returning();

// Update the output with the approval issue id
await db
  .update(outputs)
  .set({ approvalIssueId: approvalIssue!.id })
  .where(eq(outputs.id, outputId));

// Chapter cycle issues (1 per chapter, assigned to CEO who invokes the skill)
const chapterTitles = [
  "Munich — the beating heart of Bavaria",
  "The Alps — mountains, meadows and marmots",
  "Neuschwanstein — fairy-tale castle on the rock",
  "Oktoberfest — more than just a festival",
  "The Isar — a river that runs wild",
  "Nuremberg — old town, lebkuchen and toy trains",
  "The Romantic Road — knights, walled towns and legends",
  "Bavarian food — pretzels, weisswurst and beyond",
  "Lakes and forests — the quiet Bavaria",
  "Famous Bavarians — inventors, artists and adventurers",
];

for (let i = 0; i < chapterTitles.length; i++) {
  const chapter = i + 1;
  await db.insert(issues).values({
    companyId,
    projectId,
    goalId,
    title: `Chapter ${chapter}: ${chapterTitles[i]}`,
    description: `Run the full chapter production cycle for Chapter ${chapter} of the Bavaria book.

Invoke the skill: \`/book-chapter-cycle chapter=${chapter} region=Bavaria book_output_id=${outputId}\`

This will:
1. Sophie (researcher) produces the research brief
2. Max (writer) writes the 800–1 200 word draft
3. Tim (illustrator briefer) writes 3 illustration briefs
4. Anna (editor) reviews and approves (or requests revision)

Mark this issue done only after the editor gives PASS.`,
    status: "backlog",
    priority: chapter <= 3 ? "high" : "medium",
    assigneeAgentId: ceoId,
    createdByAgentId: ceoId,
  });
}

// Final assembly issue — editor checks full book, CEO releases v1
await db.insert(issues).values({
  companyId,
  projectId,
  goalId,
  title: "Final editorial pass & release v1",
  description: `All 10 chapters are complete. Run the final editorial pass on the full Output draft.

Anna (editor): read the entire Output \`${outputId}\`, check narrative arc, consistency,
chapter hooks, and overall reading experience. Post APPROVED or REVISION-NEEDED.

On APPROVED: Lena (CEO) releases the Output as v1 via
\`POST /api/outputs/${outputId}/versions\` with release notes summarising the full cycle.

Do NOT release until all chapters have individually passed their editorial review.`,
  status: "backlog",
  priority: "high",
  assigneeAgentId: editorId,
  createdByAgentId: ceoId,
});

console.log(`  ${chapterTitles.length + 2} issues created`);

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------
console.log(`
✅ Odysseia Publishing configured successfully.

  Company:    ${companyId}
  CEO:        ${ceoId}  (Lena Hoffmann)
  Writer:     ${writerId}  (Max Bauer)
  Researcher: ${researcherId}  (Sophie Klein)
  Editor:     ${editorId}  (Anna Fischer)
  Illustrator:${illustratorId}  (Tim Richter)

  Goal:    ${goalId}
  Project: ${projectId}
  Output:  ${outputId}  [pending CEO approval]

Next steps:
  1. Start the Stapler server (pnpm dev)
  2. Open the UI → Odysseia Publishing
  3. The CEO approval issue is waiting — approve it to kick off production
  4. Agents will run chapter cycles autonomously, each scored by the flywheel
  5. Watch Output "Bavaria — A Kids' Journey" fill up with chapters
  6. v1 releases automatically once all 10 chapters pass editorial review
`);

// db connection closes automatically when process exits (postgres.js)
