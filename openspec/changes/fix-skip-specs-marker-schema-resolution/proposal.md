# Fix skip_specs / retire_capabilities marker schema resolution

## Why

`readBooleanMarker` (`src/utils/change-metadata.ts`) decides whether a change's
`skip_specs: true` / `retire_capabilities: true` marker may be honored. Its
documented contract is that it "mirrors readChangeMetadata" — the marker counts
only when the metadata would load for status and instructions. It does not
mirror it. Two independent defects make it reject schema names the rest of the
CLI resolves without complaint:

**A. The project root is derived, never passed.** The function computes
`path.resolve(changeDir, '../../..')`, which is correct only for the canonical
`<root>/openspec/changes/<name>` layout. A project whose `openspec/config.yaml`
sets a custom `changesDir` (a shared spec store outside the repo) has its change
directories somewhere else entirely, so the derivation lands on an unrelated
ancestor directory. Measured on a real project whose `changesDir` points at an
Obsidian vault, the derivation produced `/Users/<user>` — three levels above the
vault, nowhere near the project.

**B. Plugin schemas are never listed.** Even given the correct root, the call is
`listSchemas(projectRoot)` with no `loadedPlugins` argument. `listSchemas` only
contributes plugin-provided schemas when that argument is supplied — unlike
`resolveSchema`, which auto-loads plugins from `projectRoot`. `readChangeMetadata`
passes `getLoadedPlugins(projectRoot)`; `readBooleanMarker` does not. Measured on
the same project, `listSchemas(correctRoot)` returned `['spec-driven']` while
`listSchemas(correctRoot, getLoadedPlugins(correctRoot))` returned all six
plugin-provided schemas.

The user-visible result is a validator that contradicts itself:

```
✗ [ERROR] .openspec.yaml: skip_specs is set but .openspec.yaml is not valid change
          metadata, so the marker is not honored. Fix the metadata
          (schema: unknown schema 'odoo-refactor')
✗ [ERROR] file: Change must have at least one delta. ... If this change intentionally
          modifies no specs, set "skip_specs: true" in the change's .openspec.yaml instead.
```

The second error prescribes exactly what the change already did, while
`openspec schema which odoo-refactor` resolves that same name to a plugin schema
without difficulty. Every change on the affected project that declares
`skip_specs` fails; every change that does not declare it validates normally,
including changes on the very same `odoo-refactor` schema. The split falls on the
marker path, not on the schema name.

## What Changes

- `readBooleanMarker` accepts the project root from its caller and falls back to
  today's derivation only when none is given, so canonical and store layouts keep
  working untouched.
- `readBooleanMarker` passes `getLoadedPlugins(projectRoot)` to `listSchemas`,
  restoring the "mirrors readChangeMetadata" contract it documents.
- Every marker call site threads the project root it already holds: both
  `Validator` entry points and the four direct calls in `archive.ts`. Fixing
  validate alone would move the divergence one phase later — the change would
  validate clean and then fail at archive with the same unknown-schema error,
  which is the bidirectional drift the contract exists to prevent.
- When the marker is set but cannot be honored, the zero-delta ERROR that tells
  the author to set `skip_specs: true` is suppressed. The marker error and the
  "Next steps" footer already name both available fixes; the extra error only
  points at the one action the author has already taken.

## Impact

- Affected specs: `schema-resolution`, `cli-validate`
- Affected code: `src/utils/change-metadata.ts`, `src/core/validation/validator.ts`,
  `src/core/validation/gate-checker.ts`, `src/core/archive.ts`
- No schema files, templates, or `.openspec.yaml` files change. Projects on the
  canonical layout with no plugins see identical behavior.
