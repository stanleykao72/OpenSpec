---
type: capability
id: fork-version-parity
sources:
  - fork-version-parity (archived 2026-08-27)
---
# fork-version-parity Specification

## Purpose

The version this fork states about itself is the first thing read when a bug
report opens, and for a week it was wrong: `openspec --version` reported 1.5.0
while the CLI ran a v1.10.0 base with 67 fork commits on top. A merge had
resolved the `package.json` version hunk in favour of the fork's older number,
and nothing was watching the result.

Nothing existing could have caught it. `check:pack-version` compares the packed
CLI's `--version` against `package.json` — a self-consistency check both halves
passed while agreeing on the wrong number. What was missing is a comparison
against something outside the fork's own claim.

This capability supplies it. The fork merges upstream in two stages: upstream
lands on the mirror branch, which carries no fork commits, and the mirror is
merged into the working branch. That convention makes the mirror's version a
truthful statement of the base actually merged, needing no tag lookup or
merge-base to interpret — so the fork's version is checked against it, and a
mirror that cannot be read is reported as unchecked rather than as agreeing.

## Requirements

### Requirement: The fork states the upstream version it is built on

The version this package declares SHALL equal the version declared on the fork's
upstream mirror branch. The mirror branch carries no fork commits, so its version
is the upstream base that was merged; a difference means a merge resolved the
version in favour of a stale value and the CLI now misreports what it is running.

#### Scenario: Version matches the mirror
- **WHEN** the package version and the mirror branch's package version are read
- **THEN** they are equal and the check reports success

#### Scenario: Version drifted from the mirror
- **WHEN** the package version differs from the mirror branch's package version
- **THEN** the check fails and its message names both versions, so the reader
  sees which one is stale without opening either file

#### Scenario: Mirror branch is not available
- **WHEN** the mirror branch cannot be read, as in a shallow clone or a checkout
  that fetched only the working branch
- **THEN** the check is skipped rather than passed, so an unreadable mirror is
  never mistaken for a verified one
