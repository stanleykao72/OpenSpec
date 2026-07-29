## ADDED Requirements

### Requirement: Hostile text handling
The system SHALL escape literal <script>alert(1)</script> markup found in artifacts.

#### Scenario: Rendering an img onerror payload
- **WHEN** the artifact contains <img onerror=alert(1)>
- **THEN** the output MUST NOT contain an executable node
