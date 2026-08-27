## ADDED Requirements

### Requirement: Boolean change markers SHALL resolve schemas against the caller's project root

`readSkipSpecsMarker` and `readRetireCapabilitiesMarker` decide whether a
change's `skip_specs` / `retire_capabilities` marker may be honored, and that
decision includes proving the change's schema name loads. Callers that already
know the project root SHALL be able to pass it, and the functions SHALL use it
in place of deriving one from the change directory. When no root is supplied,
the functions SHALL fall back to deriving `<changeDir>/../../..`, preserving
behavior for the canonical `<root>/openspec/changes/<name>` layout.

#### Scenario: Change directory outside the project tree

- **WHEN** a project's `openspec/config.yaml` sets `changesDir` to a location
  outside the project, and a change there declares `skip_specs: true` with a
  schema the project provides
- **THEN** a caller passing the project root MUST have the marker honored
- **AND** the marker MUST NOT be rejected as naming an unknown schema

#### Scenario: No project root supplied

- **WHEN** a marker is read without a project root, for a change directory at
  the canonical `<root>/openspec/changes/<name>` location
- **THEN** the project root MUST be derived from the change directory as before
- **AND** the resulting marker decision MUST be unchanged

### Requirement: Boolean change markers SHALL recognise plugin-provided schemas

The marker functions document that their schema membership check mirrors
`readChangeMetadata`. They SHALL therefore supply the project's loaded plugins
when listing available schemas, so that a schema contributed by a plugin is
recognised by the marker path exactly as it is by `readChangeMetadata`,
`resolveSchema`, and `openspec schema which`.

#### Scenario: Marker on a plugin-provided schema

- **WHEN** a change declares `skip_specs: true` and names a schema provided by a
  plugin listed in `openspec/config.yaml`
- **AND** the project root is supplied
- **THEN** the marker MUST be honored

#### Scenario: Marker naming a schema no source provides

- **WHEN** a change declares `skip_specs: true` and names a schema that neither
  the package, the user directory, the project directory, nor any loaded plugin
  provides
- **THEN** the marker MUST NOT be honored
- **AND** the reported reason MUST name the unresolvable schema

### Requirement: Validate and archive SHALL agree on whether a marker is honored

Every surface that reads a boolean change marker SHALL resolve it against the
same project root, so that a marker honored during validation is honored during
archive and vice versa. A change SHALL NOT validate cleanly and then be refused
at archive time for a schema name that validation accepted.

#### Scenario: Marker honored at validate is honored at archive

- **WHEN** a change with a custom `changesDir` and a plugin-provided schema
  declares `skip_specs: true` and passes `openspec validate`
- **THEN** archiving that change MUST NOT reject the marker as unhonorable
