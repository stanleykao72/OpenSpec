# Tasks: Upstream Contribution

## 0. Icebreaker — Establish trust with upstream maintainer

- [x] Review open P0 issues (#879, #881, #920) and identify one where plugin system insight is relevant
- [x] Leave a thoughtful comment explaining how the fork's plugin architecture addresses the issue
  - Posted on PR #891: https://github.com/Fission-AI/OpenSpec/pull/891#issuecomment-4234369497
  - Connected to TabishB's "unify-template-generation-pipeline" vision
- [x] Maintainer ack — 2026-04-13: TabishB replied "definitely be interested, let me take a look and get back to you"
- [x] **Status (2026-05-04)**: 21 days silence. TabishB's attention shifted to workspace foundation (PR #1045 merged 05-04). Treat as **stalled, not negative** — push forward with T1 to force review.

## 0.5. Sync upstream/main into fork (2026-05-04)

- [x] Merge `upstream/main` into `sync/upstream-v1.3.1` branch
  - 9 conflict files, 32 hunks; 4 real semantic decisions (CORE_WORKFLOWS union, instruction-loader nesting, etc.)
- [x] All tests green: 1719/1719
- [x] PR opened: https://github.com/stanleykao72/OpenSpec/pull/12
- [x] Update this umbrella with workspace-aware revisions (this commit)

## 1. PR: Plugin Foundation (T1) — submit FIRST

Commits: a3a0270, a037ec5, 6ba2731, 354c7f2, fbec042, 9446dbd

**Risk: HIGH** — surface area was just refactored by workspace-foundation (PR #1045). Rebase from latest upstream/main (after #1045 merge) and expect conflict resolution work in `init.ts/templates.ts/instructions.ts/instruction-loader.ts`. Reference sync/upstream-v1.3.1 PR #12 in fork as proof-of-concept that conflicts are tractable.

- [ ] Create branch `feat/plugin-system` from latest upstream/main (post-#1045)
- [ ] Cherry-pick and adapt commits (remove Odoo references)
- [ ] Verify: `src/core/plugin/` (types, loader, hook-dispatcher, config-validator, context)
- [ ] Verify: `src/commands/plugin.ts` (list, info subcommands)
- [ ] Verify: skill overlay injection in `src/core/update.ts`
- [ ] Verify: schema resolution supports plugin-bundled schemas
- [ ] Include `schemas/spec-driven/schema.yaml` as default example
- [ ] PR body: cite sync PR #12 conflict resolution; explicitly state "plugin-foundation is repo-local; workspace-level plugins are out of scope"
- [ ] Run build + tests
- [ ] `gh pr create -R Fission-AI/OpenSpec`
- [ ] Record PR URL: ___
- [ ] Track review feedback and iterate
- [ ] Merged: [ ]

## 2. PR: Fingerprinting & Staleness Detection (T5) — submit IN PARALLEL with T1

Commits: 375ce99

**Risk: LOW** — gate-checker internal, no workspace coupling. Submit in parallel with T1 (no dependency).

- [ ] Create branch `feat/gate-fingerprinting` from latest upstream/main
- [ ] Cherry-pick: content-based fingerprinting
- [ ] Verify: SHA256 fingerprinting of tracked artifacts
- [ ] Verify: stale gate detection in gate synthesis
- [ ] Run build + tests
- [ ] `gh pr create -R Fission-AI/OpenSpec`
- [ ] Record PR URL: ___
- [ ] Merged: [ ]

## 3. PR: Orchestration Hints (T3) — submit AFTER T1 lands

Commits: 34af9ac, c552889

**Risk: LOW** (downgraded from MEDIUM) — workspace-neutral cross-cutting flags.

- [ ] Rebase from upstream/main (now includes T1)
- [ ] Create branch `feat/orchestration-hints`
- [ ] Cherry-pick: CLI-native orchestration, default_mode, --sequential
- [ ] Verify: `src/core/orchestration/` (types, resolver, domain-parser, group-builder)
- [ ] Verify: --subagents, --teams, --sequential CLI flags
- [ ] Run build + tests
- [ ] `gh pr create -R Fission-AI/OpenSpec`
- [ ] Record PR URL: ___
- [ ] Merged: [ ]

## 4. PR: Workflow Phase Extension (T2) — DEFERRED

Commits: 11c22d2, 63cae69, 22dde36, 9b3818e

**Risk: MEDIUM** — overlaps with `workspace-verify-and-archive` slice 6 (proposed). Default plan: wait for slice 6 to land, then refactor T2 into workspace-aware verify/archive support OR fold our intent into upstream's design.

Decision gates before submitting:
- [ ] Has slice 6 (workspace-verify-and-archive) landed in upstream?
  - If yes → re-pitch T2 as a workspace-aware addition (or skip if slice 6 covers our use case)
  - If no after 60+ days → submit T2 anyway as "phase mechanism for slice 6"; cite slice 6 proposal in PR body
- [ ] CORE_WORKFLOWS friction: be ready to argue for keeping `verify` in CORE alongside upstream's `sync`

(Sub-tasks unchanged when execution time arrives — see prior section content.)

## 5. PR: Pipeline Runner + Gates/Hooks Execution (T4) — DEFERRED

Commits: a324c3c, 5e0c7db, df81ea0, 1b0cc82 (gates portion), 4c762cc, 13bb4e9

**Risk: HIGH** — `apply` semantics being redefined by slice 5 `workspace-apply-repo-slice` (proposed). `openspec run start/complete` must reckon with workspace vs repo-local change scope. Hard to ship before slice 5 lands.

Decision gates before submitting:
- [ ] Has slice 5 (workspace-apply-repo-slice) landed?
  - If yes → refactor T4's runner to be workspace-aware; gate-checker reads from workspace `changes/` if applicable
  - If no after 90+ days → submit T4 anyway as "pipeline mechanism for slice 5"; offer to add workspace-aware path in follow-up
- [ ] Verify gate-checker remains decoupled from `apply` semantics (so slice 5 doesn't force gate-checker rewrite)

(Sub-tasks unchanged when execution time arrives — see prior section content.)
