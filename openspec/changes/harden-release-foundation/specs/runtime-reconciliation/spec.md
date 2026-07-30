## ADDED Requirements

### Requirement: Runtime truth snapshot
The system SHALL collect a read-only runtime snapshot before repairing persisted tasks after application startup. The snapshot MUST identify project path availability, repository identity, branch and worktree presence, agent/PTY presence, coordinator MCP registration, task watcher registration, and remote listener session without performing destructive mutation.

#### Scenario: Startup observes externally changed Git state
- **WHEN** a persisted task references a worktree or branch that was changed outside Parallel Code
- **THEN** the system records the observed Git state before attempting repair and does not delete the task record during observation

#### Scenario: Project path is unavailable
- **WHEN** a persisted task belongs to a project path that cannot be read
- **THEN** the snapshot marks the project unavailable and the system does not infer that its worktree or branch is safe to delete

### Requirement: Deterministic reconciliation plan
The system SHALL derive a deterministic reconciliation plan from persisted intent and the runtime snapshot. Each task result MUST be classified as `healthy`, `repaired`, `action-required`, or `unrecoverable`, and every planned mutation MUST state its target, prerequisite observations, and expected postcondition.

#### Scenario: Runtime registrations are missing but Git resources are valid
- **WHEN** a persisted coordinator task has a valid project and worktree but its MCP or watcher registration is absent
- **THEN** the plan contains safe re-registration actions and classifies the final task as `repaired` after their postconditions are met

#### Scenario: Resource ownership is ambiguous
- **WHEN** the observed worktree or branch cannot be proven to belong to the persisted task
- **THEN** the plan performs no destructive action and classifies the task as `action-required` with an actionable reason

### Requirement: Recoverable lifecycle operations
The system MUST execute close, merge, land, cleanup, and runtime teardown as idempotent phased operations. It SHALL persist a minimal operation journal before the first irreversible phase and SHALL retain the task UI record, completed checkpoints, failure phase, and retry action until the operation reaches its terminal postcondition.

#### Scenario: Merge succeeds and worktree cleanup fails
- **WHEN** a task branch is merged successfully but worktree removal fails
- **THEN** retry resumes from cleanup without repeating the merge and the task remains visible as partially completed

#### Scenario: Application exits during close
- **WHEN** the application restarts with an incomplete close operation journal
- **THEN** reconciliation verifies completed checkpoints and safely resumes or requests action without silently removing the task

#### Scenario: Repeated teardown request
- **WHEN** the same watcher, MCP server, PTY, or listener teardown phase is invoked more than once
- **THEN** the repeated invocation reaches the same terminal postcondition without failing solely because the resource is already absent

### Requirement: Safe diagnostic persistence
Reconciliation and operation journal data MUST be versioned and backward-compatible. It MUST NOT persist authentication tokens, prompts, terminal output, diff content, or source code, and malformed diagnostic metadata MUST NOT prevent the application from loading otherwise valid state.

#### Scenario: Older state has no journal fields
- **WHEN** the current application loads a valid state file written before operation journals existed
- **THEN** it loads the state and treats missing diagnostic fields as absent without data loss

#### Scenario: Diagnostic field is malformed
- **WHEN** optional reconciliation metadata is invalid but the core task record is valid
- **THEN** the system discards or quarantines the invalid diagnostic field and reports the recovery without refusing startup
