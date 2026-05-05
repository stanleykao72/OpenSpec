# Upstream Contribution: Plugin System & Orchestration Platform

## Problem

OpenSpec is currently a static spec-driven development tool. It generates instruction files and manages change artifacts, but lacks:

1. **Extensibility** — No way for teams to add custom lifecycle hooks, quality gates, or domain-specific schemas without forking
2. **Quality assurance** — No automated validation that artifacts (proposal, specs, design, tasks) are aligned and traceable
3. **Orchestration** — No mechanism to express parallel/sequential execution preferences for multi-agent workflows
4. **Pipeline execution** — No runtime for automatically executing gates and hooks at lifecycle boundaries

This fork has developed and production-tested these capabilities over 3 months of daily use in an Odoo 18 Enterprise development environment.

## Proposed Solution

Contribute the fork's 25 commits to upstream Fission-AI/OpenSpec as 5 sequential PRs, preceded by a Phase 0 icebreaker engagement. Each PR builds on the previous, and we wait for merge before opening the next.

### PR Sequence (revised 2026-05-04 after workspace foundation landed)

Upstream has shifted priority to a **cross-repo workspace model** (workspace-foundation merged in PR #1045 on 2026-05-04). Workspace slice 3–6 proposals overlap with our T2/T4 surface area. The original sequential plan is preserved below for context, but execution order and risk have been reassessed.

| PR | Name | New order | Risk | Workspace overlap |
|----|------|-----------|------|-------------------|
| T0 | Icebreaker | DONE (PR #891 comment, TabishB ack 04-13, then 21+ days silent) | — | n/a |
| **T1** | Plugin Foundation | **submit first** | **HIGH** (was MEDIUM) | Touches `init.ts/templates.ts/instructions.ts` — same surface workspace-foundation just refactored |
| **T5** | Fingerprinting | **submit in parallel with T1** | LOW | None — gate-checker internal |
| **T3** | Orchestration Hints | submit after T1 lands | LOW (was MEDIUM) | Cross-cutting, workspace-neutral |
| T2 | Workflow Phase Extension (verify/archive) | **defer or reframe** | MEDIUM | **Direct overlap** with `workspace-verify-and-archive` slice 6 (proposed). Either reframe as "phase mechanism for slice 6" or fold in. |
| T4 | Pipeline Runner | **defer until slice 5 lands** | HIGH | **Direct overlap** with `workspace-apply-repo-slice` slice 5 (proposed). `apply` semantics being redefined per repo-slice; T4's `openspec run start/complete` would need workspace-awareness. |

**Why this order**: T1 + T5 + T3 ship the broad-utility primitives; T2/T4 are deferred until upstream commits to a workspace-friendly seam, otherwise we waste rebase effort fighting the wrong abstraction.

### What stays internal (NOT contributed)

- Odoo-specific schemas (odoo-sdd, odoo-bugfix, odoo-trivial, odoo-refactor)
- alignment-check, dual-review, code-quality plugins (kept as independent examples)
- Obsidian vault sync hooks
- Git branch/worktree policy hooks

## Success Criteria

- All 5 PRs merged into Fission-AI/OpenSpec main
- Upstream tests pass (excluding pre-existing `@inquirer/core` issue)
- No Odoo-specific code in upstream
- Plugin system documented in upstream README

## Constraints

- Conservative strategy: one PR at a time, wait for merge
- Each PR must rebase onto latest upstream/main (which includes previous merged PR)
- Upstream maintainer (TabishB) has ~24-48h review turnaround
- Estimated total timeline: 3-6 weeks
- `contextFiles` type changed from `string` to `string[]` in v1.3.0 — all fork code adapted during rebase

## Risks

| Risk | Mitigation |
|------|-----------|
| Upstream rejects plugin architecture | Phase 0 done (TabishB ack 04-13); silence since then is risk indicator — push T1 to force a review |
| Workspace path eats T2/T4 surface | Defer T2/T4; reframe as workspace-aware after slice 5/6 stabilize |
| API changes requested after PR1 | Each subsequent PR rebases from merged upstream, adapts as needed |
| Long review cycles | Work on other projects during wait; conservative strategy reduces rework |
| Workspace foundation blocks plugin auto-discovery for cross-repo | T1 must explicitly state "plugin-foundation is repo-local; workspace-level plugins are out of scope here" |
| Maintainer attention saturated by workspace path | Submit T1 + T5 with explicit "complementary, not competing" framing; reference slice 1/2 architecture in PR body |
