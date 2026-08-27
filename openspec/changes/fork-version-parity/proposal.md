# Fork version parity

## Why

`openspec --version` reported 1.5.0 while the CLI ran a v1.10.0 base with 67 fork
commits on top. The v1.10.0 merge resolved the `package.json` version hunk in
favour of the fork's stale number, and nothing noticed for a week. A version the
tool states about itself is the first thing anyone reads when a bug report starts,
so a wrong one costs a debugging session before the real question is reached.

`check:pack-version` cannot catch this class of error. It compares the packed
CLI's `--version` against `package.json` — a self-consistency check that both
halves passed while agreeing on the wrong number.

## What Changes

- Add a guard that fails when `package.json`'s version differs from the version
  on the fork's upstream mirror branch (`main`), which by convention carries zero
  fork commits and therefore always states the upstream base actually merged.
- The guard runs in the existing suite, so `pnpm test` covers it without new
  wiring.

## Capabilities

- **New Capabilities**: `fork-version-parity`
- **Modified Capabilities**: none

## Impact

`test/fork/version-parity.test.ts` (new). No source or runtime change — the guard
observes the repository, it does not alter the CLI.
