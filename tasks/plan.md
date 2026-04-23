# Plan: Level 3 Skill Slash Commands

> Full Claude Code-style skill execution via `/skill-name` in Stapler issue threads.

---

## What we're building

When a user (or agent) types `/plan-phase` in an issue comment, Stapler:

1. Detects the slash command and records a `skill_invocations` row
2. Wakes the issue's assigned agent with `wakeReason: "skill_command_invoked"`
3. The adapter puts the skill's SKILL.md as the agent's **primary task** (not just ambient context)
4. The agent executes the skill — calling tools, posting progress comments, reading memory
5. On completion the skill run posts a structured result comment to the thread
6. The `skill_invocations` row is finalized with status + result comment ID

Skills can themselves call `stapler_invoke_skill` to chain other skills or delegate to a specialist agent.

---

## What already exists (don't rebuild)

| Piece | Location |
|---|---|
| Comment → wakeup pipeline | `server/src/routes/issues.ts` lines 2297–2361 |
| `contextSnapshot` passed to adapter | `heartbeat.ts` `executeRun()` lines 3226+ |
| `paperclipRuntimeSkills` in run config | `heartbeat.ts` line 3378 |
| Skill markdown loading | `adapter-utils/src/server-utils.ts` `readPaperclipSkillMarkdown` |
| Claude skill materialization | `adapters/claude-local/src/server/skills.ts` |
| Ollama skill injection | `adapters/ollama-local/src/server/execute.ts` lines 291–304 |
| Agent comment posting MCP tool | `mcp-server/src/tools.ts` `addComment` |
| Company skill DB + service | `db/src/schema/company_skills.ts`, `services/company-skills.ts` |
| MCP tool pattern | `mcp-server/src/tools.ts` `delegateTask` as reference |

---

## Architecture

```
User types "/plan-phase [args]" in issue comment
        │
        ▼
issues.ts PATCH handler (comment creation)
  ├─ Parse slash command → skillKey + args
  ├─ Look up skill in companySkillService
  ├─ INSERT skill_invocations row (status: "pending")
  └─ heartbeat.wakeup(agentId, { wakeReason: "skill_command_invoked",
                                  contextSnapshot: { skillCommandName,
                                                     skillInvocationId,
                                                     skillArgs, ... } })
        │
        ▼
heartbeat.ts executeRun()
  ├─ Detects wakeReason === "skill_command_invoked"
  ├─ Loads skill markdown from companySkillService
  ├─ Injects into context as paperclipSkillCommand: { name, markdown, args }
  └─ Calls adapter execute()
        │
        ▼
Adapter (claude-local / ollama-local)
  ├─ Sees paperclipSkillCommand in context
  ├─ Puts skill markdown as PRIMARY task (before system prompt)
  ├─ Agent executes — tools available: addComment (progress),
  │   stapler_invoke_skill (chain), stapler_delegate_task (handoff)
  └─ Agent posts result comment to issue thread
        │
        ▼
issues.ts POST /comments (result comment)
  ├─ Detects createdByRunId linked to skill_invocations row
  └─ UPDATE skill_invocations SET status="succeeded", resultCommentId=...
        │
        ▼  (or on run failure)
heartbeat.ts finalize
  └─ UPDATE skill_invocations SET status="failed"
```

---

## New MCP tools

### `stapler_invoke_skill(skillName, args?, targetAgentId?)`
Allows an agent to invoke a skill — on itself or delegate to another agent. Returns immediately with `invocationId`; the skill runs asynchronously.

### `stapler_skill_progress(message)`  
Posts a progress comment to the current issue thread, attributed to the skill run. Agents call this to show multi-step progress (like Claude Code's `<parameter name="status_update">` pattern).

---

## New DB table: `skill_invocations`

```sql
CREATE TABLE skill_invocations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id),
  issue_id      UUID NOT NULL REFERENCES issues(id),
  agent_id      UUID REFERENCES agents(id),
  skill_key     TEXT NOT NULL,
  args          JSONB,
  status        TEXT NOT NULL DEFAULT 'pending',
                -- pending | running | succeeded | failed | cancelled
  trigger_comment_id   UUID REFERENCES issue_comments(id),
  heartbeat_run_id     UUID REFERENCES heartbeat_runs(id),
  result_comment_id    UUID REFERENCES issue_comments(id),
  error_message        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## Files to create

| File | Purpose |
|---|---|
| `packages/db/src/schema/skill_invocations.ts` | Drizzle schema |
| `packages/db/src/migrations/0068_skill_invocations.sql` | Migration |
| `server/src/services/skill-invoker.ts` | Parse slash cmd, create row, trigger wakeup |
| `server/src/services/skill-executor.ts` | Finalize invocation on run end, inject skill into context |
| `server/src/routes/skill-invocations.ts` | GET /skill-invocations/:id, list per issue |
| `ui/src/components/SkillCommandChip.tsx` | Chip shown in issue thread for in-progress invocation |
| `ui/src/components/SlashCommandMenu.tsx` | Autocomplete dropdown in comment composer |

## Files to modify

| File | Change |
|---|---|
| `packages/db/src/schema/index.ts` | Export `skillInvocations` |
| `server/src/routes/issues.ts` | Detect `/cmd` in comment body, call skill-invoker |
| `server/src/services/heartbeat.ts` | Inject `paperclipSkillCommand` context + finalize invocation |
| `packages/mcp-server/src/tools.ts` | Add `stapler_invoke_skill` + `stapler_skill_progress` |
| `packages/adapters/claude-local/src/server/execute.ts` | Handle `paperclipSkillCommand` as primary task |
| `packages/adapters/ollama-local/src/server/execute.ts` | Handle `paperclipSkillCommand` as primary task |
| `server/src/app.ts` (or routes index) | Mount skill-invocations router |
| `ui/src/pages/IssueDetail.tsx` | Render SkillCommandChip in thread, wire SlashCommandMenu |
| `ui/src/api/skills.ts` | API calls for skill invocations |

---

## Phases

### Phase A — Data layer + pipeline (Tasks 1–3)
Database, slash command detection, wakeup with skill context.
Checkpoint: posting `/plan-phase` in a comment creates a `skill_invocations` row and triggers an agent wakeup.

### Phase B — Execution + result (Tasks 4–6)
Adapter changes to treat skill as primary task, finalization, MCP tools.
Checkpoint: agent receives skill markdown as its task, executes, posts a result comment, invocation row finalized.

### Phase C — Skill chaining + UI (Tasks 7–9)
`stapler_invoke_skill`, progress tool, slash command autocomplete, thread chip.
Checkpoint: full end-to-end — autocomplete → execute → progress chips → result comment.

---

## Vertical task slices

Each task is a complete working path, not a horizontal layer.

### Task 1 — `skill_invocations` DB table
**Files:** schema, migration, db index export  
**Acceptance:** `pnpm --filter @stapler/db migrate` applies cleanly; `skillInvocations` exported from `@stapler/db`; `pnpm -r typecheck` clean.

### Task 2 — Slash command parser + invocation row
**Files:** `skill-invoker.ts` (new), `issues.ts` (modify comment creation path)  
**Acceptance:** POST a comment body `/plan-phase` to an issue with an assigned agent → `skill_invocations` row created with `status: "pending"`, `skill_key: "plan-phase"` → agent wakeup enqueued with `wakeReason: "skill_command_invoked"` in contextSnapshot.

### Task 3 — Skill context injection in heartbeat
**Files:** `heartbeat.ts` (modify `executeRun`), `skill-executor.ts` (new, provides `loadSkillForRun`)  
**Acceptance:** When a run has `wakeReason: "skill_command_invoked"`, `context.paperclipSkillCommand` is set to `{ name, markdown, args }` before the adapter is called. Invocation row transitions to `status: "running"` + `heartbeatRunId` set.

### Task 4 — Claude adapter: skill as primary task
**Files:** `adapters/claude-local/src/server/execute.ts`  
**Acceptance:** When `context.paperclipSkillCommand` is present, the SKILL.md content is prepended to the user turn (before issue context) so it is the first thing the agent sees. Existing skill ambient injection is suppressed for this run.

### Task 5 — Ollama adapter: skill as primary task
**Files:** `adapters/ollama-local/src/server/execute.ts`  
**Acceptance:** Same as Task 4 for Ollama — skill markdown put at top of system prompt, tagged `<skill-command>`, other skill injections suppressed.

### Task 6 — Run finalization → invocation result
**Files:** `heartbeat.ts` (finalize path), `skill-executor.ts` (add `finalizeSkillInvocation`)  
**Acceptance:** On run `succeeded` → `skill_invocations.status = "succeeded"`, `result_comment_id` set to the agent's last comment in the thread for that run. On run `failed` → `status = "failed"`, `error_message` set.

### Task 7 — `skill-invocations` API route
**Files:** `server/src/routes/skill-invocations.ts` (new), app router  
**Acceptance:** `GET /api/skill-invocations/:id` returns invocation + linked skill key + status. `GET /api/issues/:id/skill-invocations` returns list for issue. Auth: board actor with company access.

### Task 8 — MCP tools: `stapler_invoke_skill` + `stapler_skill_progress`
**Files:** `packages/mcp-server/src/tools.ts`  
**Acceptance:**  
- `stapler_invoke_skill("plan-phase")` called by an agent creates a `skill_invocations` row and wakes the target (defaults to same agent/issue). Returns `{ invocationId }`.  
- `stapler_skill_progress("Analyzing codebase...")` posts a comment to the current issue from the current run. Returns `{ commentId }`.

### Task 9 — UI: slash command autocomplete + thread chip
**Files:** `SlashCommandMenu.tsx` (new), `SkillCommandChip.tsx` (new), `IssueDetail.tsx`, `ui/src/api/skills.ts`  
**Acceptance:**  
- Typing `/` in the comment composer opens a skill picker showing available skills by name.  
- In-progress invocations show a spinner chip in the thread above the result.  
- Completed invocations show a ✓ chip linking to the result comment.

---

## Acceptance criteria (system-level)

1. Type `/gsd:plan-phase` in an issue comment → agent wakes, executes plan-phase skill, posts plan to thread. No config change needed.
2. Agent calls `stapler_invoke_skill("gsd:debug")` mid-run → second invocation starts, posts debug output as a separate comment chain.
3. Agent calls `stapler_skill_progress("Step 1/3: reading files")` → comment appears in thread within 2s.
4. Invocation fails (skill not found, agent errors) → `skill_invocations.status = "failed"`, error comment posted.
5. `GET /api/issues/:id/skill-invocations` returns all invocations for the issue with status.
6. `pnpm -r typecheck` clean. All flywheel tests still pass.
