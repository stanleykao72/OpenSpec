# Design

## D1 — Fix at the call site, not inside `listSchemas`

`listSchemas(projectRoot)` omitting plugin schemas is deliberate: the argument is
how a caller says "resolve plugins for me", and `listSchemasWithInfo`,
`validateSchemaName`, and `readChangeMetadata` all opt in explicitly. Making
`listSchemas` auto-load plugins would change what every other caller sees in
order to fix one of them.

`readBooleanMarker` is the caller that forgot to opt in. It gets the argument,
exactly as `readChangeMetadata` does. `resolveSchema` already auto-loads
(`resolver.ts:202`) and needs no change once the root is right.

**Rejected:** auto-loading inside `listSchemas`. It fixes the symptom by
altering an API contract three other call sites depend on.

## D2 — Optional `projectRoot` parameter, derivation as fallback

`readSkipSpecsMarker(changeDir)` and `readRetireCapabilitiesMarker(changeDir)`
gain an optional second parameter. When absent, the existing
`path.resolve(changeDir, '../../..')` derivation runs unchanged.

This keeps every untouched call site (including any outside this repo) on
today's behavior, and keeps the canonical layout working when no root is at
hand. The derivation is a fallback, not a contract — the doc comment currently
states it *is* the contract, and that sentence is what this change rewrites.

**Rejected:** making the parameter required. It would be a breaking signature
change for a function whose fallback is correct in the common case.

**Rejected:** re-reading `openspec/config.yaml` inside `readBooleanMarker` to
discover the root. The root is what locates the config; deriving one from the
other is circular. Callers already hold `root.path`.

## D3 — Thread every marker call site, not only the failing one

The doc comment states the constraint: "Validate and archive must never honor
metadata the rest of the CLI rejects, in either direction." Six call sites read
a marker:

| Site | Root available as |
|---|---|
| `validator.ts:108` (`validateChange`) | none today — add an options parameter |
| `validator.ts:424` (`validateChangeDeltaSpecs`) | `options.projectRoot` |
| `archive.ts:807`, `:1245`, `:1418`, `:1547` | archive's own resolved root |

Two internal validator calls pass no options and must also thread the root:
`archive.ts:1273` and `gate-checker.ts:387`.

Fixing only `validator.ts:424` would let the three affected changes validate
clean and then fail at archive with the identical unknown-schema error. That is
not a partial fix; it relocates the divergence to a later, more expensive phase.

## D4 — Suppress the contradictory zero-delta error

When `marker.invalidReason` is set, the author demonstrably set the marker.
Emitting `CHANGE_NO_DELTAS` — whose text ends "set `skip_specs: true` in the
change's `.openspec.yaml` instead" — tells them to do the thing they did.

Precedent is in this file: `validateChange` (~`:117`) already filters
`CHANGE_NO_DELTAS` when `marker.declared`. This extends the same rule to the
unhonorable case in `validateChangeDeltaSpecs`.

The suppression is narrow and does not weaken validation:

- The marker ERROR still fires, so the report is still invalid and the exit code
  still non-zero.
- The "Next steps" footer already lists both routes (fix the metadata, or drop
  the marker and add deltas).
- The `skip_specs` + files-present conflict error is a different gate and is
  untouched.

**Rejected:** rewording `CHANGE_NO_DELTAS`. It is correct for the case it was
written for (no marker at all); the defect is that it co-fires with a marker
error, not that its wording is wrong.

## D5 — Test the plugin path specifically

A project-local schema under `openspec/schemas/` cannot detect defect B:
`listSchemas(projectRoot)` already contributes project-local schemas without any
`loadedPlugins` argument, so such a test passes with the defect fully present.
Only a plugin-provided schema — `openspec/config.yaml` listing the plugin,
`openspec/plugins/<name>/plugin.yaml` declaring `schemas:`, and the schema under
`openspec/plugins/<name>/schemas/<schema>/schema.yaml` — exercises the argument
this change adds.

Defect A needs a change directory that is *not* `<root>/openspec/changes/<name>`,
so the derivation cannot accidentally land on the right root.

## D6 — A separate `markerProjectRoot` option, not `projectRoot`

`validateChangeDeltaSpecs` uses the *presence* of `options.projectRoot` as the
switch for an unrelated check: the ambiguous task-numbering pass (#1520,
`validator.ts:461`). Archive and the gate checker have never passed it, so they
have never run that pass.

Passing `projectRoot` from those callers to fix marker resolution would silently
switch task-numbering checks on at archive and gate time, and could block an
archive that used to succeed — a behavior change nothing in this proposal asks
for. So the marker root arrives as its own option, `markerProjectRoot`,
defaulting to `projectRoot` so the CLI validate path (which wants both) passes
one value as before.

**Rejected:** passing `projectRoot` and accepting the extra pass. It couples an
unrelated validation change to a bug fix, and the coupling only reveals itself
when someone's archive starts failing.

**Rejected:** decoupling task numbering from `projectRoot` presence in this
change. It is the right cleanup, but it changes what existing callers validate,
which is exactly the scope creep the previous option avoids.

## D7 — Both validate passes drop the contradictory error, not one

`validateChange` (the proposal-level pass archive prints as warnings) contained
the same pairing, and two tests asserted it. Fixing only
`validateChangeDeltaSpecs` would leave the two passes disagreeing about one
marker — the same class of divergence between surfaces that D3 exists to
prevent, just relocated. Both now drop `CHANGE_NO_DELTAS` when the marker is
declared *or* unhonorable, and the two tests were updated to assert the new
behavior rather than worked around.

## Not changed: the archived-path retirement workaround

`assertRetirementAuthorization` is called once with `verifyMarker: false` and a
comment explaining that "archived changes are nested one level deeper than
active changes, so the marker reader cannot resolve their schema" — a workaround
for defect A, written before the root could be passed. An explicit root would
now make that call resolvable, but it verifies exact content equality against
the already-validated authorization, which is strictly stronger than re-reading
the marker. Left alone; noted here as a follow-up, not folded into this change.

## Risks

- **`getLoadedPlugins` is memoized on a single `projectRoot`.** Threading real
  roots means more distinct roots reach it in one process (bulk validate across
  a store). The cache invalidates on root change rather than keying by root, so
  alternating roots re-load each time. This is a performance characteristic, not
  a correctness one, and bulk validate already resolves one root per run.
- **A previously-unhonorable marker becoming honorable changes archive
  behavior** for the affected changes: archive will now accept zero deltas where
  it used to refuse. That is the intended fix, and it is the same decision the
  author already recorded in `.openspec.yaml`.
- **Suppressing an ERROR is a validation-surface reduction.** Bounded by the
  fact that another ERROR always accompanies it, so no report flips from invalid
  to valid. A test asserts the report stays invalid.
