## ADDED Requirements

### Requirement: Validation SHALL NOT prescribe an action the author has already taken

When a change declares a `skip_specs` marker that cannot be honored, validation
reports why the marker was rejected. It SHALL NOT additionally emit the
zero-delta error whose remediation text instructs the author to set
`skip_specs: true`, because that marker is present in the file already and the
resulting pair of errors prescribes contradictory actions.

Suppression SHALL be limited to that one error. The marker error SHALL still be
reported, the report SHALL remain invalid, and the `skip_specs`-with-spec-files
conflict error SHALL be unaffected.

#### Scenario: Unhonorable marker with no deltas

- **WHEN** a change declares `skip_specs: true`, has no delta specs, and the
  marker cannot be honored
- **THEN** the output MUST report the reason the marker was rejected
- **AND** the output MUST NOT also instruct the author to set `skip_specs: true`
- **AND** the report MUST still be invalid

#### Scenario: No marker at all with no deltas

- **WHEN** a change has no delta specs and declares no `skip_specs` marker
- **THEN** the zero-delta error MUST still be reported in full, including its
  suggestion to set `skip_specs: true`
