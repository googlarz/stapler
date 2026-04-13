# Roadmap: Stapler Feature Milestone v2

## Overview

Six phases that bring Ollama agents to feature parity with Claude agents, then layer in UI improvements and developer tooling. Phases 1-2 build out the Ollama adapter (new tools, memory injection, streaming). Phase 3 adds company-level shared memories. Phases 4-5 deliver read-only UI additions (goals progress, run cost, agent template, bulk proposals). Phase 6 adds the benchmarking page.

## Phases

- [ ] **Phase 1: Ollama Tools + Memory Injection** - Add 3 new tools to the Ollama adapter and wire memory injection
- [ ] **Phase 2: Ollama Streaming** - Stream tokens to run output in real time
- [ ] **Phase 3: Company Shared Memories** - New DB table, REST API, and Ollama tool for company-scoped memories
- [ ] **Phase 4: Goals + Budget UI** - Progress bar on goal detail, estimated cost on run list/detail
- [ ] **Phase 5: Agent Template + Propose Bulk** - AGENTS.md documents Stapler tools; Propose Tasks bulk create
- [ ] **Phase 6: Ollama Benchmarking** - Page to compare installed Ollama models on speed and output quality

## Phase Details

### Phase 1: Ollama Tools + Memory Injection
**Goal**: Ollama agents have the same tool surface as Claude agents for memory and goal management, and receive relevant memories in their system prompt at run start
**Depends on**: Nothing (first phase)
**Requirements**: OLLAMA-01, OLLAMA-02, OLLAMA-03, MEMORY-01
**Success Criteria** (what must be TRUE):
  1. An Ollama agent can call `paperclip_delete_memory` and the targeted memory is removed from the DB
  2. An Ollama agent can call `paperclip_create_goal` and the goal appears in the goals list
  3. An Ollama agent can call `paperclip_update_goal` and the goal's status/description changes
  4. When an Ollama run starts, a `## Relevant memories` section is prepended to the system prompt (matching Claude adapter behavior), visible in run logs
**Plans**: TBD

### Phase 2: Ollama Streaming
**Goal**: Ollama agent output appears progressively in the run log as tokens are generated, not all-at-once after the model finishes
**Depends on**: Phase 1
**Requirements**: STREAM-01
**Success Criteria** (what must be TRUE):
  1. Run output in the UI updates incrementally during an Ollama run (tokens stream in real time)
  2. The final run log contains the same content whether streaming was on or off
  3. An Ollama run that is interrupted mid-stream records the partial output in the run log
**Plans**: TBD

### Phase 3: Company Shared Memories
**Goal**: Any agent in a company can read and write company-level memories that persist independently of any single agent
**Depends on**: Phase 1
**Requirements**: MEMORY-02, MEMORY-03
**Success Criteria** (what must be TRUE):
  1. `POST /api/companies/:id/memories` creates a shared memory accessible by all agents in that company
  2. `GET /api/companies/:id/memories` returns all company-level memories (distinct from agent memories)
  3. An Ollama agent can call `paperclip_list_company_memories` and receive the current shared memories list
  4. A memory written by agent A is returned when agent B queries company memories in the same company
**Plans**: TBD

### Phase 4: Goals + Budget UI
**Goal**: Users can see goal progress at a glance and understand the USD cost of Claude runs without leaving the UI
**Depends on**: Phase 3
**Requirements**: GOALS-01, BUDGET-01
**Success Criteria** (what must be TRUE):
  1. Goal detail page shows a progress bar with done/total linked issue counts (e.g., "3/7 issues done")
  2. Agent run list shows an estimated USD cost column for Claude runs (blank for Ollama runs)
  3. Agent run detail shows the same estimated cost with input/output token breakdown
  4. A goal with no linked issues shows a neutral/empty state (not a broken bar)
**Plans**: TBD

### Phase 5: Agent Template + Propose Bulk
**Goal**: New agents are onboarded with tool documentation, and users can create multiple proposed tasks in one action
**Depends on**: Phase 4
**Requirements**: AGENTS-01, PROPOSE-01
**Success Criteria** (what must be TRUE):
  1. The default AGENTS.md generated for a new agent lists all Stapler-specific tools (memory, goal tools) with brief descriptions
  2. Propose Tasks dialog has checkboxes on each proposal and a "Create selected" button
  3. Selecting N proposals and clicking "Create selected" creates exactly N issues in a single action
**Plans**: TBD

### Phase 6: Ollama Benchmarking
**Goal**: Users can compare installed Ollama models side-by-side on a single fixed prompt to pick the best model for their agents
**Depends on**: Phase 5
**Requirements**: BENCH-01
**Success Criteria** (what must be TRUE):
  1. A benchmarking page (or modal) is reachable from the Ollama settings area and lists all installed models
  2. Running a benchmark sends the fixed sample prompt to each selected model and displays response time and output
  3. Results are displayed in a comparable table or card layout (model name, response time, output text)
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Ollama Tools + Memory Injection | 0/TBD | Not started | - |
| 2. Ollama Streaming | 0/TBD | Not started | - |
| 3. Company Shared Memories | 0/TBD | Not started | - |
| 4. Goals + Budget UI | 0/TBD | Not started | - |
| 5. Agent Template + Propose Bulk | 0/TBD | Not started | - |
| 6. Ollama Benchmarking | 0/TBD | Not started | - |
