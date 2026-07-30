## 1. Baseline and Traceability

- [ ] 1.1 Create a machine-readable matrix mapping PRD acceptance criteria 1–10 and the three new capability specs to existing or planned checks
- [ ] 1.2 Inventory the current test suites, execution times, environment dependencies, timeouts, skipped tests, and known full-suite failures
- [ ] 1.3 Add deterministic fake repo, fake agent, terminal-output, state-corruption, and crash-point fixtures shared by integration and packaged tests
- [ ] 1.4 Record the initial ten-task event-loop, queue, buffer, subprocess, and memory baseline on the documented reference environment

## 2. Runtime Observation and Planning

- [ ] 2.1 Define versioned runtime snapshot, reconciliation action, task result, and report types without storing sensitive content
- [ ] 2.2 Implement read-only observers for project/repo identity, branch/worktree presence, PTY, MCP, watcher, and remote listener state
- [ ] 2.3 Implement the pure reconciliation planner with deterministic ordering, prerequisites, postconditions, and ownership ambiguity handling
- [ ] 2.4 Add planner tests for healthy, missing registration, external Git mutation, unavailable project, ambiguous ownership, and malformed optional metadata
- [ ] 2.5 Integrate report-only reconciliation into startup and expose task-level `healthy`, `repaired`, `action-required`, and `unrecoverable` diagnostics

## 3. Recoverable Lifecycle Operations

- [ ] 3.1 Add a backward-compatible operation journal schema and atomic persistence for close, merge, land, cleanup, and teardown phases
- [ ] 3.2 Refactor task close into idempotent checkpoints with retry that preserves the UI record and failure phase
- [ ] 3.3 Refactor merge and coordinator land/cleanup into idempotent checkpoints that never repeat a confirmed merge
- [ ] 3.4 Make PTY, MCP, watcher, and remote listener teardown idempotent and verify already-absent resources as success
- [ ] 3.5 Add crash injection tests at every irreversible checkpoint and verify restart roll-forward or `action-required` behavior
- [ ] 3.6 Enable only proven non-destructive reconciliation repairs and require explicit user action for ambiguous destructive targets

## 4. Bounded Workload

- [ ] 4.1 Centralize configurable terminal, remote replay, diff, Markdown, IPC queue, and polling limits with test overrides
- [ ] 4.2 Enforce terminal/replay buffer budgets and producer-side IPC batching/backpressure while preserving ordered state transitions
- [ ] 4.3 Enforce diff and Markdown payload/render budgets with visible truncation or segmented-load recovery paths
- [ ] 4.4 Add resource-keyed single-flight, cancellation/stale-result handling, and visibility throttling to Git, PR, and coverage probes
- [ ] 4.5 Add deterministic tests for producer-over-consumer pressure, oversized content, duplicate probes, and offscreen attention states
- [ ] 4.6 Build the ten-visible-task load suite and make correctness, bounded-resource, and documented responsiveness budgets hard assertions

## 5. Release Verification

- [ ] 5.1 Implement a fast release lane covering compile/typecheck, lint, format, unit/integration, filesystem safety, scope security, reconciliation, recovery, and bounded-workload checks
- [ ] 5.2 Implement safe JSON and Markdown report generation with check IDs, platform, harness/toolchain version, result, duration, artifact references, and final release decision
- [ ] 5.3 Add report allowlisting/redaction tests that reject tokens, prompts, terminal transcripts, source payloads, and credentials
- [ ] 5.4 Implement packaged smoke harness for add repo, create/restart worktree task, fake agent, diff, merge, keyboard navigation, remote authorization, and corrupt-state recovery
- [ ] 5.5 Run and stabilize the packaged smoke lane on the supported macOS architecture matrix
- [ ] 5.6 Run and stabilize the packaged smoke lane on the selected Linux distribution baseline
- [ ] 5.7 Configure release automation so missing, skipped, timed-out, or failed required evidence yields `incomplete` or `not-ready` and blocks automatic release

## 6. Documentation and Exit Review

- [ ] 6.1 Document reconciliation statuses, retry behavior, content limits, performance reference environment, and operator recovery steps
- [ ] 6.2 Update release documentation and privacy/security notes to describe local verification artifacts and confirm no telemetry was introduced
- [ ] 6.3 Resolve or explicitly defer the four design open questions with owners and target milestones
- [ ] 6.4 Execute the complete matrix for a release candidate, review all evidence, and record the final `ready`, `not-ready`, or `incomplete` decision
