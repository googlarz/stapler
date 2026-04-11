# Stapler

**A curated, friendly fork of [paperclipai/paperclip](https://github.com/paperclipai/paperclip) — with the features upstream hasn't merged yet.**

> Paperclip slips off. A stapler commits.

Stapler is Paperclip with a set of contribution PRs pre-merged and kept current against upstream. It is **not** a hostile fork — no renaming of packages, no divergent architecture, no competing branding. All the hard work is still `paperclipai/paperclip`. Stapler just gives you a place to run production against a tree where good fixes actually land.

---

## Why this fork exists

I contribute fixes and features upstream. Most go through review and merge. Some get stuck — closed without comment, caught in review limbo, or blocked behind a decision that isn't coming. Rather than babysit every PR through upstream's process, Stapler bundles them into a single branch I can ship from, with upstream tracked as a remote so I can pull in their changes whenever I want.

If you contribute to Paperclip too and you've ever watched a clean PR sit untouched for days, this fork exists for you.

---

## What's different from `paperclipai/paperclip`

This fork carries 6 commits on top of upstream master. Each one is a direct port of an open or closed upstream PR, squashed for clean history:

| Commit | Feature | Upstream PR | Status upstream |
|---|---|---|---|
| `1e5afa4f` | `fix: validate assigneeAgentId issue filters before querying` | [paperclipai/paperclip#3198](https://github.com/paperclipai/paperclip/pull/3198) | **Closed without comment** by maintainer. Second attempt at the same fix (first was [#2302](https://github.com/paperclipai/paperclip/pull/2302), also closed). |
| `3289907c` | `feat(goals): acceptance criteria + target date` | [paperclipai/paperclip#3278](https://github.com/paperclipai/paperclip/pull/3278) | **Open**, all Greptile findings resolved. |
| `0886fdd1` | `feat(goals): automatic verification loop for acceptance criteria` | [paperclipai/paperclip#3280](https://github.com/paperclipai/paperclip/pull/3280) | **Draft**, chained on #3278. |
| `0dd128f4` | `fix(goals): audit every verification state transition` | [paperclipai/paperclip#3280](https://github.com/paperclipai/paperclip/pull/3280) | Follow-up fix addressing Gardener bot's activity-log audit gap. |
| `86d4a503` | `feat(agents): per-agent memory store with keyword search` | [paperclipai/paperclip#3289](https://github.com/paperclipai/paperclip/pull/3289) | **Open**, all Greptile findings resolved. |
| `1f250d0d` | `feat(agents): MCP tools, skill docs, and UI panel for agent memory` | Not yet opened upstream (chained on #3289). | Branch ready at `googlarz/paperclip:feat/agent-memory-mcp-ui`. |

### What you actually get over upstream

- **Agents can call `memory.save(...)` and `memory.search(...)` during runs.** Per-agent keyword-searchable notes store via `pg_trgm`. HTTP API at `/agents/:agentId/memories` that every adapter can already reach via `PAPERCLIP_API_KEY`. Four new MCP tools for adapters that support MCP natively. Read-only "Memories" tab on the agent detail page. Hard agent-identity isolation via new `assertAgentIdentity` authz guard — closes the `paperclipApiRequest` raw-URL escape hatch.
- **Goals have acceptance criteria and target dates.** Editable criteria list, progress bar based on linked issues (cancelled excluded), with a proper inline text editor that doesn't clobber your keystrokes mid-edit.
- **Goals get automatically verified when their linked issues all reach `done`.** Server auto-creates a verification issue assigned to the goal's owner agent, who judges each criterion and posts a fenced `json verification_outcome` block. On pass, the goal flips to `achieved` with a full audit trail. On fail, a follow-up issue is created. Max 3 attempts, manual retrigger button as an escape hatch.
- **Query parameter validation on the issues list endpoint.** No more silent "DB error on `assigneeAgentId=undefined`" — you get a clean 400 with a zod error.

### What's NOT different

- **Branding, package names, env vars, licensing.** All still `paperclipai`, `PAPERCLIP_API_KEY`, `@paperclipai/shared`, MIT license. Stapler is the repo name, nothing else. The underlying system is still Paperclip.
- **Upstream Paperclip itself.** This fork tracks `upstream/master` as a remote. Pulling in their changes is a standard `git fetch upstream && git rebase upstream/master` away.
- **Contribution direction.** I still open PRs upstream first. This fork exists because some of them get stuck, not because I'm trying to route around the project.

---

## Syncing with upstream

```bash
git remote add upstream https://github.com/paperclipai/paperclip.git
git fetch upstream master

# Option A — rebase my commits on top of new upstream
git checkout main
git rebase upstream/master

# Option B — merge upstream into main (preserves merge commits)
git checkout main
git merge upstream/master
```

Conflicts are likely in `packages/db/src/migrations/meta/_journal.json` and the `migrations/*.sql` numbering when upstream adds new migrations. The pattern is: rename any of my migrations that collide with upstream's new ones, bump journal `idx`, done.

---

## Quickstart

Stapler runs exactly like Paperclip. See the upstream [Quickstart](https://github.com/paperclipai/paperclip#quickstart) — no setup differences.

```bash
git clone https://github.com/googlarz/stapler.git
cd stapler
pnpm install
pnpm dev
```

For the agent memory feature specifically:

```bash
# As an authenticated agent
curl -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -X POST "$PAPERCLIP_API_URL/agents/$PAPERCLIP_AGENT_ID/memories" \
  -d '{"content":"user prefers French over English","tags":["preference","language"]}'

# Later, same or future run
curl -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  "$PAPERCLIP_API_URL/agents/$PAPERCLIP_AGENT_ID/memories?q=french&limit=5"
```

See `skills/paperclip/SKILL.md` for the full agent-facing contract.

---

## License

MIT, same as upstream. Copyright 2025 Paperclip AI (upstream original) plus contributor attributions per commit. See [LICENSE](./LICENSE).

---

## Credits

- **[paperclipai/paperclip](https://github.com/paperclipai/paperclip)** — the real project. Stapler is a thin layer on top.
- **[@davison](https://github.com/davison)** — mempalace / memory adapter framework in [paperclipai/paperclip#3250](https://github.com/paperclipai/paperclip/pull/3250). Complementary to the agent memory primitive in this fork.
- **[@cryppadotta](https://github.com/cryppadotta)** — paperclipai maintainer. Most of the code you're running came from their reviews.

---

## Open upstream PRs

If you want any of these features landed in `paperclipai/paperclip` itself (which would make this fork smaller), a thumbs-up or review on any of these helps:

- [#3278 — feat(goals): acceptance criteria](https://github.com/paperclipai/paperclip/pull/3278)
- [#3280 — feat(goals): verification loop](https://github.com/paperclipai/paperclip/pull/3280) (draft, chained on #3278)
- [#3289 — feat(agents): memory store](https://github.com/paperclipai/paperclip/pull/3289)
