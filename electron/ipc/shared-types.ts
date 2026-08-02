export type PtyOutput =
  // Raw PTY bytes. Sent as a Node Buffer from the main process; Electron's
  // structured clone delivers it to the renderer as a Uint8Array, which is
  // what xterm's write() already accepts — so no encoding step is needed.
  // (getAgentScrollback() still returns base64: its consumers are the remote
  // HTTP/WS JSON surface and the MCP coordinator, where a string is correct.)
  | { type: 'Data'; data: Uint8Array }
  | {
      type: 'Exit';
      data: { exit_code: number | null; signal: string | null; last_output: string[] };
    };

export interface AgentDef {
  id: string;
  name: string;
  command: string;
  args: string[];
  resume_args: string[];
  skip_permissions_args: string[];
  description: string;
  available?: boolean;
  /** Per-agent override for the stability-check delay (ms) used before auto-sending
   *  the initial prompt.  Agents with multi-step init dialogs need a longer wait. */
  prompt_ready_delay_ms?: number;
  /** CLI flag used to pass an MCP config path to this agent. Omit when unsupported. */
  mcp_config_flag?: string;
}

export interface CreateTaskResult {
  id: string;
  branch_name: string;
  worktree_path: string;
}

export interface SymlinkCandidate {
  name: string;
  isDefault: boolean;
}

/** Legacy name used by renderer IPC consumers. */
export type GitIgnoredEntry = SymlinkCandidate;

export interface ChangedFile {
  path: string;
  lines_added: number;
  lines_removed: number;
  status: string;
  committed: boolean;
}

export interface CoverageMetricSummary {
  total: number;
  covered: number;
  skipped: number;
  pct: number;
}

export interface CoverageFileSummary {
  path: string;
  lines: CoverageMetricSummary;
  statements: CoverageMetricSummary;
  functions: CoverageMetricSummary;
  branches: CoverageMetricSummary;
}

export interface CoverageSummary {
  format: 'istanbul-summary' | 'lcov';
  generatedAt: string;
  reportPath: string;
  totals: Omit<CoverageFileSummary, 'path'>;
  files: Record<string, CoverageFileSummary>;
}

export interface WorktreeStatus {
  has_committed_changes: boolean;
  has_uncommitted_changes: boolean;
  current_branch: string | null;
}

export interface ImportableWorktree {
  path: string;
  branch_name: string;
  has_committed_changes: boolean;
  has_uncommitted_changes: boolean;
}

export interface MergeStatus {
  main_ahead_count: number;
  conflicting_files: string[];
  base_branch: string;
}

export interface MergeResult {
  main_branch: string;
  lines_added: number;
  lines_removed: number;
}

export interface FileDiffResult {
  diff: string;
  oldContent: string;
  newContent: string;
}

export interface CommitInfo {
  hash: string;
  message: string;
}

export type PrCheckBucket = 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel';
export type PrChecksOverall = 'pending' | 'success' | 'failure' | 'none';

export interface PrCheckRun {
  name: string;
  bucket: PrCheckBucket;
}

export interface PrChecksUpdatePayload {
  taskId: string;
  overall: PrChecksOverall;
  passing: number;
  pending: number;
  failing: number;
  checks: PrCheckRun[];
  checkedAt: string;
  /** True when the main process has stopped watching this task (PR merged or
   *  closed). The renderer should drop its bookkeeping so a later restart of
   *  the watcher (e.g. PR reopened) goes through cleanly. */
  cleared: boolean;
}

export interface BranchPrDetectionResult {
  url: string | null;
  unavailable?: 'missing' | 'auth';
}

export interface StepEntry {
  summary: string;
  detail?: string;
  next?: string;
  status: 'starting' | 'investigating' | 'implementing' | 'testing' | 'awaiting_review' | 'done';
  files_touched?: string[];
  /** Optional sub-agent identifier — short label (e.g. "auth-worker") so the UI can
   *  group entries written on behalf of delegated work. Omit for the top-level agent. */
  agent_id?: string;
  timestamp: string;
}

/** AI CLIs whose local usage records Parallel Code reads. */
// Kept a type, not a value array: `src/ipc/types.ts` re-exports this module
// type-only, and dependency-cruiser forbids the renderer importing anything
// runtime out of `electron/`. Each side lists the providers it needs to iterate.
// `claude-vertex` is not a separate CLI and has no log directory of its own: it
// is Claude Code pointed at Google's Vertex AI, writing into the same
// `~/.claude/projects` tree. It is a separate account against a separate quota,
// so it gets its own column rather than being summed into `claude`. It has no
// entry in the provider status list for the same reason — there is nothing
// separate for the user to install or be missing.
//
// `agy` is Antigravity, the one provider that does not write JSONL — it keeps
// one SQLite database per conversation with the counters in protobuf blobs.
// That difference lives entirely inside the reader; by the time a count reaches
// here it is the same four integers as everyone else's.
export type ProviderId = 'claude' | 'claude-vertex' | 'codex' | 'grok' | 'agy';

/**
 * Four disjoint token counts. Each provider reports these differently — some
 * fold cached tokens into the input count — so the readers normalise before
 * anything is summed, and by this point `input` never includes `cacheRead`.
 */
export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** One worktree/project path and what each CLI spent under it. */
export interface TokenUsagePathRow {
  path: string;
  totals: TokenTotals;
  byProvider: Partial<Record<ProviderId, TokenTotals>>;
}

/** Whether a CLI's local log directory exists at all. Absent is normal. */
export interface TokenUsageProviderStatus {
  provider: ProviderId;
  /** False when the CLI is simply not installed — not an error. */
  present: boolean;
  /** Records skipped because they were malformed or of an unknown shape. */
  skipped: number;
  /** Set when reading failed for a reason other than "not there". */
  error?: string;
}

export interface TokenUsageSnapshot {
  paths: TokenUsagePathRow[];
  totals: TokenTotals;
  byProvider: Partial<Record<ProviderId, TokenTotals>>;
  providers: TokenUsageProviderStatus[];
  /** Epoch ms the snapshot was assembled. */
  updatedAt: number;
}
/**
 * One line of a session transcript.
 *
 * The vocabulary is borrowed, not invented — each kind maps to a detection
 * module that already existed: `agent` (spawn/exit), `step` (the six StepEntry
 * stages above), `attention` (ready / needs_input / error), `merge`, `pr-checks`
 * and `commit`. See `electron/ipc/transcript.ts` for the storage rules.
 */
export type TranscriptEventKind = 'agent' | 'step' | 'attention' | 'merge' | 'pr-checks' | 'commit';

export interface TranscriptEvent {
  /** On-disk format version of this line. */
  v: number;
  /** ISO-8601, stamped by the main process — never by the sender. */
  ts: string;
  taskId: string;
  kind: TranscriptEventKind;
  /** Sub-classification inside the kind: `spawned`, `implementing`, `ready`, … */
  status: string;
  summary: string;
  detail?: string;
  /** Ids of the redaction rules that fired. Absent when none did. */
  redacted?: string[];
}

/** What a renderer hands to the main process; `v` and `ts` are added there. */
export type TranscriptEventInput = Pick<
  TranscriptEvent,
  'taskId' | 'kind' | 'status' | 'summary' | 'detail'
>;

/** The subset of a Huly issue the app stores and renders. */
export interface HulyIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  modifiedOn: number;
}
