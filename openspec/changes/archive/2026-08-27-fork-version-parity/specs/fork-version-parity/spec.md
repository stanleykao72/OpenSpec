# fork-version-parity Specification

## ADDED Requirements

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
