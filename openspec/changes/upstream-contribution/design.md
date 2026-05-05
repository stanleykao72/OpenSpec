# Design: Upstream Contribution Strategy

## Architecture Decisions

### AD-1: contextFiles type adaptation (v1.3.0)

Upstream changed `ApplyInstructions.contextFiles` from `Record<string, string>` to `Record<string, string[]>` to support glob artifact outputs.

**Impact on fork code:**
- `src/core/pipeline/runner.ts` — reads contextFiles for gate synthesis context
- `src/core/orchestration/resolver.ts` — reads contextFiles for task grouping
- `src/commands/workflow/instructions.ts` — covers injection reads contextFiles

**Resolution:** Handled during rebase (2026-04-13). All fork code now treats contextFiles values as `string[]`. The rebase was clean — auto-merge succeeded for `shared.ts` type change.

### AD-2: update.ts transformer composition

Fork adds `composeTransformers(overlayTransformer, toolTransformer)` pattern. Upstream added `pi` tool to the hyphen-command condition.

**Resolution:** Merged both — `pi` added to condition, overlay composition preserved:
```typescript
const toolTransformer = (tool.value === 'opencode' || tool.value === 'pi')
  ? transformToHyphenCommands : undefined;
const transformer = composeTransformers(overlayTransformer, toolTransformer);
```

### AD-5: Workspace foundation impact (added 2026-05-04)

Upstream merged `workspace-foundation` (PR #1045, archived as canonical spec) on 2026-05-04. This introduces a cross-repo planning model: workspaces live at `<global-data-dir>/workspaces/<name>/`, link multiple repos via stable names, and own `changes/` at the workspace root.

Six slices are planned (1+2 landed, 3-6 proposed):

| Slice | Status | Surface that conflicts with our PRs |
|-------|--------|-------------------------------------|
| `workspace-foundation` | landed | `instructions.ts`, `templates.ts`, `instruction-loader.ts`, `profiles.ts` — already merged into fork via sync/upstream-v1.3.1 |
| `workspace-create-and-register-repos` | landed (CLI beta) | Setup CLI surface — no overlap with our PRs |
| `workspace-open-agent-context` | proposed | Context injection — overlaps T1's plugin-loaded skill content |
| `workspace-change-planning` | proposed | New change creation — neutral |
| `workspace-apply-repo-slice` | proposed | **`apply` redefined as repo-slice implementation** — directly conflicts with T4's `openspec run start/complete` model |
| `workspace-verify-and-archive` | proposed | **verify/archive at workspace + repo level** — directly conflicts with T2's phase extension model |

**Strategic implications:**

1. **T1 (Plugin Foundation)** — surface already churned by foundation slice. Rebase will be expensive but achievable. Submit early before slice 3 lands and adds another layer.

2. **T2 (Workflow Phases)** — verify/archive phase types we want to add will likely be redefined by slice 6. Two paths:
   - (a) Submit T2 anyway, position as "phase machinery that slice 6 can build on"
   - (b) Wait for slice 6, then merge our verify/archive intent into the workspace model
   - Default: (b) — saves rework, signals respect for upstream direction.

3. **T4 (Pipeline Runner)** — `apply` semantics redefined by slice 5. `openspec run start/complete` would need to know whether it's running on a workspace change or a repo-local change. Defer until slice 5 stabilizes.

4. **T3 (Orchestration Hints)** — workspace-neutral; flags affect agent dispatch regardless of change scope. Lower-risk; can ship after T1.

5. **T5 (Fingerprinting)** — gate-checker internal, no workspace coupling. Independent.

**CORE_WORKFLOWS union** (sync/upstream-v1.3.1 merge resolution): both `verify` (fork) and `sync` (upstream workspace) are now default-active. T2 PR upstream must reckon with this — either remove `verify` from CORE if upstream prefers minimal default, or argue for keeping both. This is a foreseeable point of friction.

### AD-3: Odoo-specific content exclusion

The following content exists in the fork but MUST NOT be included in any upstream PR:

| Content | Location | Reason |
|---------|----------|--------|
| `schemas/odoo-sdd/` | Deleted from fork, lives in odoo-claude-code | Domain-specific |
| `schemas/odoo-workflow/` | Deleted from fork, lives in odoo-claude-code | Domain-specific |
| Odoo change proposals | `openspec/changes/` | Project-specific |
| `openspec-parallel-merge-plan.md` | Root | Fork-specific planning doc |

### AD-4: PR dependency chain

```
T0 (icebreaker) ── no code dependency
  │
  T1 (plugin foundation)
  │  exports: PluginManifest, PluginLoader, HookDispatcher, ConfigValidator
  │  new CLI: openspec plugin list|info
  │
  ├── T2 (workflow phases) ── depends on T1 schema types
  │   extends: SchemaYaml with verify/archive phases
  │
  ├── T3 (orchestration) ── depends on T1 plugin loader
  │   new CLI flags: --subagents, --teams, --sequential
  │   new module: src/core/orchestration/
  │
  │   └── T4 (pipeline runner) ── depends on T1 + T3
  │       new CLI: openspec run, openspec gate
  │       new module: src/core/pipeline/
  │
  └── T5 (fingerprinting) ── weak dependency on T4 gate-checker
      extends: gate-checker with content fingerprints
```

## Commit-to-PR Mapping

### T1: Plugin Foundation
| Fork Commit | Description |
|-------------|-------------|
| `a3a0270` | Plugin system core (loader, hooks, config, gates, schemas) |
| `a037ec5` | Skill overlays injection |
| `6ba2731` | README plugin documentation |
| `354c7f2` | Archive add-skill-overlays change |
| `fbec042` | Fix plugin-provided schema resolution |
| `9446dbd` | Fix loadTemplate plugin schema resolution |

### T2: Workflow Phase Extension
| Fork Commit | Description |
|-------------|-------------|
| `11c22d2` | Configurable changesDir |
| `63cae69` | Verify and archive phase schema support |

### T3: Orchestration Hints
| Fork Commit | Description |
|-------------|-------------|
| `34af9ac` | CLI-native orchestration hints |
| `c552889` | Schema default_mode and --sequential flag |

### T4: Pipeline Runner
| Fork Commit | Description |
|-------------|-------------|
| `a324c3c` | Pipeline runner (runner, lock, types) |
| `5e0c7db` | Fix hook command CWD resolution |
| `df81ea0` | Covers auto-injection, change class routing |

### T5: Fingerprinting
| Fork Commit | Description |
|-------------|-------------|
| `375ce99` | Content-based fingerprinting for gate staleness |

### Not included in any PR (Odoo-specific or fork-only)
| Fork Commit | Description | Reason |
|-------------|-------------|--------|
| `acea753` | odoo-workflow schema | Odoo-specific |
| `39f5636` | Lifecycle addon for odoo-workflow | Odoo-specific |
| `c0f249b` | Align odoo-sdd schemas | Odoo-specific |
| `1b0cc82` | Schema-level quality gates + odoo-sdd | Mixed (gates go in T1, odoo-sdd stays) |
| `4c762cc` | 63 tests for gates | Goes with T1/T4 |
| `9b3818e` | Test fixes for verify addition | Goes with T2 |
| `13bb4e9` | ZshInstaller test isolation | Goes with T1 |
| `22dde36` | Strengthen spec template format | Goes with T2 |
| `778f1a5` | Ignore .actrc | Already in upstream via rebase |
| `2c92b77` | Remove Odoo plugins from dev config | Fork cleanup |

## Per-PR Checklist

For each PR before submission:

1. [ ] Create branch from latest upstream/main
2. [ ] Cherry-pick relevant commits
3. [ ] Remove any Odoo-specific content that leaked in
4. [ ] Ensure all new exports are properly typed
5. [ ] Run `npm run build` — clean compile
6. [ ] Run `npx vitest run` — only pre-existing failures allowed
7. [ ] Write PR description with context for upstream reviewers
8. [ ] Cross-reference any relevant upstream issues (#879, #920, etc.)
