## ADDED Requirements

### Requirement: Bounded high-volume content
The system SHALL enforce centralized, testable resource budgets for terminal scrollback and replay, diff payloads, Markdown rendering, and other high-volume task content in both renderer and main-process boundaries.

#### Scenario: Terminal output exceeds its budget
- **WHEN** an agent emits more terminal data than the configured byte or line budget
- **THEN** the system retains the bounded tail needed for current interaction, releases older data, and continues accepting input without unbounded memory growth

#### Scenario: Diff or Markdown exceeds render budget
- **WHEN** a diff or Markdown document exceeds its configured processing or payload budget
- **THEN** the system provides a bounded segment or explicit size error with a safe follow-up path and does not attempt an unbounded render

### Requirement: Single-flight background probes
Git, PR, and coverage polling SHALL be keyed by resource and SHALL prevent overlapping equivalent probes. Superseded work MUST be cancelable or ignored, and visibility-based throttling MUST NOT hide state transitions that require user attention.

#### Scenario: Poll interval elapses during an active probe
- **WHEN** an equivalent probe for the same repository, branch, or coverage artifact is still running
- **THEN** the system reuses, coalesces, or skips the duplicate instead of starting another subprocess or request

#### Scenario: Task becomes offscreen
- **WHEN** an active task is no longer visible
- **THEN** the system may reduce rendering or polling frequency but still surfaces needs-input, error, ready, and review transitions

### Requirement: Backpressure across IPC
The system MUST apply backpressure or bounded batching before high-frequency producer data crosses IPC. Renderer slowness SHALL NOT cause an unbounded main-process queue, and dropped or coalesced non-critical updates MUST be distinguishable from loss of a terminal state transition.

#### Scenario: Renderer cannot consume output at producer speed
- **WHEN** terminal or status events are produced faster than the renderer processes them
- **THEN** the system bounds queued data, coalesces eligible updates, and preserves ordered terminal states and current interaction

### Requirement: Ten-task responsiveness verification
The system SHALL provide a deterministic load test with ten simultaneously visible task fixtures that exercises terminal output, status changes, Git polling, diff access, and user input. The test MUST assert correctness, bounded queue/buffer behavior, and a documented event-loop responsiveness budget.

#### Scenario: Standard ten-task fixture completes
- **WHEN** the load suite runs on its documented reference environment
- **THEN** all task state transitions remain correct, input remains operable, buffers stay within limits, and responsiveness measurements satisfy the configured budget

#### Scenario: Performance budget is exceeded
- **WHEN** the fixture violates a hard correctness or responsiveness budget
- **THEN** the release-readiness fast lane fails and reports the violated metric and workload phase
