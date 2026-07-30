## ADDED Requirements

### Requirement: PRD-traceable release matrix
The project SHALL maintain a machine-readable release matrix mapping each PRD release acceptance criterion to one or more automated or explicitly manual checks, supported platforms, commands, expected evidence, and owning test lane.

#### Scenario: Acceptance criterion has no evidence
- **WHEN** a required PRD acceptance criterion lacks a passing check for a target release platform
- **THEN** the release candidate is not ready and the report identifies the missing evidence

#### Scenario: PRD acceptance changes
- **WHEN** a release acceptance criterion is added, removed, or materially changed
- **THEN** validation fails until the matrix is updated to match the current PRD

### Requirement: Fast release verification lane
The project SHALL provide a deterministic fast lane that includes compile/type checks, lint, formatting, unit and integration tests, filesystem safety rules, state corruption recovery, reconciliation crash-point fixtures, token-scope tests, and bounded-workload checks.

#### Scenario: Required fast check fails
- **WHEN** any required fast-lane check fails, times out, or is skipped without an approved exclusion
- **THEN** the lane exits unsuccessfully and identifies the exact check and evidence location

#### Scenario: Optional external tool is unavailable
- **WHEN** a check required for release evidence depends on an unavailable external tool
- **THEN** the release report marks it `not-run` and the release gate fails rather than treating absence as success

### Requirement: Cross-platform packaged smoke lane
The project MUST execute packaged smoke validation on each supported release platform. The lane SHALL cover adding a repository, creating and restarting an isolated task with a deterministic fake agent, viewing a diff, completing a merge, keyboard-only primary navigation, remote authorization boundaries, and recovery from corrupted primary state.

#### Scenario: macOS packaged flow passes
- **WHEN** the packaged macOS candidate runs the smoke lane on a supported architecture
- **THEN** every required primary flow passes and produces platform-labelled evidence

#### Scenario: Linux packaged flow passes
- **WHEN** the packaged Linux candidate runs the smoke lane on the documented distribution baseline
- **THEN** every required primary flow passes and produces platform-labelled evidence

### Requirement: Release evidence is safe and reproducible
Each release lane SHALL emit machine-readable and human-readable reports containing check id, platform, command or harness version, result, duration, and artifact references. Reports MUST redact or reject tokens, prompts, terminal content, source code, and secrets before persistence.

#### Scenario: Same commit is verified again
- **WHEN** the same commit and declared toolchain are verified with the same deterministic fixtures
- **THEN** the report contains the same required check set and equivalent pass/fail semantics

#### Scenario: Secret-like content enters a report
- **WHEN** report generation detects a token, credential, prompt, terminal transcript, or source payload in a field not explicitly allowlisted
- **THEN** it redacts or rejects the field and fails report finalization if safe evidence cannot be produced

### Requirement: Release decision is explicit
The release report MUST end in `ready`, `not-ready`, or `incomplete`. Only `ready` SHALL permit the release workflow to continue automatically; `incomplete` MUST list every missing platform or check.

#### Scenario: All required evidence passes
- **WHEN** every required fast and packaged check passes for all supported platforms
- **THEN** the report concludes `ready`

#### Scenario: Packaged platform was not executed
- **WHEN** fast checks pass but a supported platform packaged lane has not completed
- **THEN** the report concludes `incomplete` and does not authorize release
