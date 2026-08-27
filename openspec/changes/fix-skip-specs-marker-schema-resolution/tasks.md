## 1. Marker schema resolution

- [x] 1.1 Add an optional `projectRoot` parameter to `readSkipSpecsMarker`,
      `readRetireCapabilitiesMarker`, and the shared `readBooleanMarker`,
      falling back to the existing `<changeDir>/../../..` derivation
- [x] 1.2 Pass `getLoadedPlugins(projectRoot)` to `listSchemas` inside
      `readBooleanMarker`
- [x] 1.3 Rewrite the `readSkipSpecsMarker` doc comment: the derivation is a
      fallback, not the contract

## 2. Thread the project root through every call site

- [x] 2.1 `validator.ts:424` (`validateChangeDeltaSpecs`) — pass
      `options.projectRoot`
- [x] 2.2 `validator.ts:108` (`validateChange`) — add an options parameter and
      pass the root
- [x] 2.3 `archive.ts` — the four direct marker calls
- [x] 2.4 `archive.ts:1197`, `archive.ts:1273`, `gate-checker.ts:387` — pass the
      root into the validator calls that currently supply no options
- [x] 2.5 Add `markerProjectRoot` so archive and the gate checker can resolve the
      marker without switching on the task-numbering pass (design D6)
- [x] 2.6 `gate-checker.checkGate` gains a `projectRoot` option; `runner.ts` (x2)
      and `commands/gate.ts` pass the root they already hold

## 3. Suppress the contradictory zero-delta error

- [x] 3.1 In `validateChangeDeltaSpecs`, skip `CHANGE_NO_DELTAS` when
      `marker.invalidReason` is set
- [x] 3.2 Same in `validateChange`, so the two passes cannot disagree about one
      marker (design D7); the two tests asserting the old pairing were updated

## 4. Tests

- [x] 4.1 Plugin-schema fixture: config listing the plugin, `plugin.yaml`
      declaring `schemas:`, schema under the plugin's `schemas/` directory
- [x] 4.2 Custom-`changesDir` layout + explicit root + plugin schema →
      `declared: true` (fails on defect A and on defect B independently)
- [x] 4.3 No root, canonical layout → unchanged
- [x] 4.4 Unknown schema → still unhonorable, reason names the schema
- [x] 4.5 `skip_specs` + bogus schema → marker error present, no-deltas advice
      absent, report still invalid
- [x] 4.6 No marker + no deltas → zero-delta error still reported in full
- [x] 4.7 Cross-surface: the same fixture honored through archive's call shape
      (`markerProjectRoot`) and the gate checker's (`projectRoot`), plus a guard
      asserting both refuse it when no root is supplied. Without this the spec's
      "honored at validate is honored at archive" scenario rested on a type
      check rather than a run.

## 5. Verification

- [x] 5.1 `pnpm build` (the global `openspec` symlink runs `dist/`)
- [x] 5.2 Repro: all three affected changes validate clean
- [x] 5.3 Control: `unify-sale-order-line-product` (same schema, no marker)
      still passes
- [x] 5.4 Bulk totals move 24 → 27 passed; the other 23 failures are a separate
      cause (missing `.openspec.yaml`) and stay failing
- [x] 5.5 Full test suite; pre-existing upstream failures identified by
      stash-baseline, not claimed as green

## Evidence

- Repro: all three affected changes report `is valid`; controls
  `unify-sale-order-line-product` and `add-petty-cash-fund` still valid.
- Bulk: `Totals: 27 passed, 23 failed (50 items)`, up from 24/26. The 23 are a
  separate cause (no `.openspec.yaml`) and were deliberately not touched.
- New tests are not vacuous: with `src/` stashed to its pre-fix state, 8 of the
  59 tests in the two touched files fail; with the fix, 62/62 pass (59 plus the
  three cross-surface tests added afterwards).
- The archive and gate paths are covered at their call shapes, not end to end:
  no project schema declares the `validate-delta-specs` gate, and `archive` has
  no dry-run, so exercising them for real would have written to the vault spec
  store. That was not authorized and was not done.
- Full suite: 4559 passed, 10 failed across 7 files. The identical 10 failures
  appear with `src/` stashed, so all 10 pre-date this change (upstream v1.10.0
  merge fallout, already recorded by `fix-html-viewer-schema-blind`). Two of
  them — `archive.test.ts` retire_capabilities and
  `workflow-instructions-skipped.test.ts` skip_specs — sit inside this change's
  blast radius, which is why they were baselined rather than assumed.
