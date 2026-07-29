## ADDED Requirements

### Requirement: Widget export
The system SHALL allow users to export widgets as a file.

#### Scenario: Successful export
- **WHEN** the user clicks Export
- **THEN** a file is downloaded

#### Scenario: Export while offline
- **WHEN** the user clicks Export without network access
- **THEN** the system MUST show an offline error and MUST NOT queue the job
