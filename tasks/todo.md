# Todo: Level 3 Skill Slash Commands

## Phase A — Data layer + pipeline

- [ ] **Task 1** — `skill_invocations` DB table
  - [ ] `packages/db/src/schema/skill_invocations.ts`
  - [ ] `packages/db/src/migrations/0077_skill_invocations.sql`
  - [ ] Export from `packages/db/src/schema/index.ts`
  - Acceptance: migration applies; `skillInvocations` exported from `@stapler/db`; typecheck clean

- [ ] **Task 2** — Slash command parser + invocation row
  - [ ] `server/src/services/skill-invoker.ts` (new)
  - [ ] `server/src/routes/issues.ts` (detect `/cmd` in comment body)
  - Acceptance: `/plan-phase` comment → `skill_invocations` row (status: "pending") + agent wakeup with `wakeReason: "skill_command_invoked"`

- [ ] **Task 3** — Skill context injection in heartbeat
  - [ ] `server/src/services/skill-executor.ts` (new — `loadSkillForRun`)
  - [ ] `server/src/services/heartbeat.ts` (inject `paperclipSkillCommand` into context)
  - Acceptance: run with `wakeReason: "skill_command_invoked"` gets `context.paperclipSkillCommand = { name, markdown, args }`; invocation row → `status: "running"`

## Phase B — Execution + result

- [ ] **Task 4** — Claude adapter: skill as primary task
  - [ ] `packages/adapters/claude-local/src/server/execute.ts`
  - Acceptance: SKILL.md prepended to user turn; ambient skill injection suppressed for this run

- [ ] **Task 5** — Ollama adapter: skill as primary task
  - [ ] `packages/adapters/ollama-local/src/server/execute.ts`
  - Acceptance: skill markdown at top of system prompt under `<skill-command>` tag; other skill injections suppressed

- [ ] **Task 6** — Run finalization → invocation result
  - [ ] `server/src/services/skill-executor.ts` (add `finalizeSkillInvocation`)
  - [ ] `server/src/services/heartbeat.ts` (call finalize on run end)
  - Acceptance: `succeeded` run → invocation `status: "succeeded"`, `result_comment_id` set; `failed` run → `status: "failed"`, `error_message` set

## Phase C — Skill chaining + UI

- [ ] **Task 7** — `skill-invocations` API route
  - [ ] `server/src/routes/skill-invocations.ts` (new)
  - [ ] Mount in `server/src/app.ts`
  - Acceptance: `GET /api/skill-invocations/:id` returns invocation; `GET /api/issues/:id/skill-invocations` returns list

- [ ] **Task 8** — MCP tools
  - [ ] `packages/mcp-server/src/tools.ts` — add `stapler_invoke_skill` + `stapler_skill_progress`
  - Acceptance: `stapler_invoke_skill("plan-phase")` creates row + wakes agent; `stapler_skill_progress("msg")` posts comment

- [ ] **Task 9** — UI
  - [ ] `ui/src/components/SlashCommandMenu.tsx` (new)
  - [ ] `ui/src/components/SkillCommandChip.tsx` (new)
  - [ ] `ui/src/api/skills.ts` (new)
  - [ ] `ui/src/pages/IssueDetail.tsx` (wire menu + chips)
  - Acceptance: `/` in composer opens skill picker; in-progress invocations show spinner chip; completed show ✓ chip
