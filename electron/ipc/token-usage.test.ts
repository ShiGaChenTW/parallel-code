import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildTokenUsageSnapshot,
  claudeProjectsDir,
  codexSessionsDir,
  grokLogFile,
  resetTokenUsageState,
} from './token-usage.js';
import { claudeProjectSlug } from './token-usage-parse.js';
import type { TokenUsageSnapshot } from './shared-types.js';

// A fake home directory per test. `os.homedir` is re-stubbed in every
// `beforeEach` rather than once for the file: a `vi.clearAllMocks()` anywhere
// in the suite clears recorded calls but leaves implementations in place only
// if they were installed with `mockReturnValue` — re-installing per test makes
// this file behave identically alone and in the full run.
let home: string;

// The worktrees are real directories under the fake home rather than invented
// strings, because attribution now asks whether a recorded directory still
// exists — a worktree that has been removed must not be folded into the project
// that contained it. Tests that want the deleted case delete the directory.
let WT: string;
let WT2: string;

function writeClaudeTranscript(worktreePath: string, name: string, lines: string[]): string {
  const dir = path.join(claudeProjectsDir(), claudeProjectSlug(worktreePath));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, lines.map((l) => `${l}\n`).join(''), 'utf8');
  return file;
}

function claudeUsage(opts: {
  id: string;
  requestId?: string;
  cwd?: string;
  input?: number;
  output?: number;
}): string {
  return JSON.stringify({
    type: 'assistant',
    cwd: opts.cwd ?? WT,
    requestId: opts.requestId ?? 'req',
    message: {
      id: opts.id,
      usage: {
        input_tokens: opts.input ?? 10,
        output_tokens: opts.output ?? 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  });
}

const T0 = Date.parse('2026-07-31T00:00:00.000Z');
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

function writeCodexRollout(
  cwd: string,
  name: string,
  extra: string[],
  meta: Record<string, unknown> = {},
): string {
  const dir = path.join(codexSessionsDir(), '2026', '07', '31');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  const lines = [
    JSON.stringify({ timestamp: at(0), type: 'session_meta', payload: { cwd, ...meta } }),
    ...extra,
  ];
  fs.writeFileSync(file, lines.map((l) => `${l}\n`).join(''), 'utf8');
  return file;
}

interface CodexUsage {
  /** Raw `input_tokens`, which includes the cached prefix, as codex writes it. */
  input: number;
  cached?: number;
  output: number;
}

/**
 * One `token_count` record: the running session total, and what that turn alone
 * used. Both are always present in the real logs — all 16,794 records measured
 * on the machine this was written against carry a `last_token_usage` and a
 * timestamp — and the reader now needs both.
 */
function codexTokenCount(total: CodexUsage, turn: CodexUsage, atMs = 10_000): string {
  const usage = (u: CodexUsage) => ({
    input_tokens: u.input,
    cached_input_tokens: u.cached ?? 0,
    output_tokens: u.output,
    total_tokens: u.input + u.output,
  });
  return JSON.stringify({
    timestamp: at(atMs),
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { total_token_usage: usage(total), last_token_usage: usage(turn) },
    },
  });
}

function writeGrokLog(lines: string[]): string {
  const file = grokLogFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map((l) => `${l}\n`).join(''), 'utf8');
  return file;
}

function appendLines(file: string, lines: string[]): void {
  fs.appendFileSync(file, lines.map((l) => `${l}\n`).join(''), 'utf8');
}

function rowFor(snapshot: TokenUsageSnapshot, p: string) {
  return snapshot.paths.find((row) => row.path === p);
}

function statusFor(snapshot: TokenUsageSnapshot, provider: string) {
  return snapshot.providers.find((s) => s.provider === provider);
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-token-usage-'));
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  WT = path.join(home, 'project');
  WT2 = path.join(WT, '.worktrees', 'feature');
  fs.mkdirSync(WT2, { recursive: true });
  resetTokenUsageState();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetTokenUsageState();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('buildTokenUsageSnapshot — a CLI that is not installed', () => {
  it('reports every provider absent without erroring', async () => {
    const snapshot = await buildTokenUsageSnapshot([WT]);
    expect(snapshot.paths).toEqual([]);
    expect(snapshot.providers.map((p) => p.present)).toEqual([false, false, false]);
    expect(snapshot.providers.every((p) => p.error === undefined)).toBe(true);
  });

  it('reads the installed ones when another is missing', async () => {
    writeGrokLog([
      JSON.stringify({ sid: 's1', ctx: { cwd: WT } }),
      JSON.stringify({ sid: 's1', ctx: { prompt_tokens: 100, completion_tokens: 5 } }),
    ]);
    const snapshot = await buildTokenUsageSnapshot([WT]);
    expect(statusFor(snapshot, 'claude')?.present).toBe(false);
    expect(statusFor(snapshot, 'grok')?.present).toBe(true);
    expect(rowFor(snapshot, WT)?.byProvider.grok).toEqual({
      input: 100,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });
});

describe('claude transcripts', () => {
  it('attributes usage to the worktree the records name', async () => {
    writeClaudeTranscript(WT, 'a.jsonl', [
      claudeUsage({ id: 'm1', requestId: 'r1', input: 100, output: 10 }),
      claudeUsage({ id: 'm2', requestId: 'r2', input: 200, output: 20 }),
    ]);
    const snapshot = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(snapshot, WT)?.totals).toEqual({
      input: 300,
      output: 30,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it('counts a message repeated across transcripts only once', async () => {
    const duplicate = claudeUsage({ id: 'm1', requestId: 'r1', input: 100, output: 10 });
    writeClaudeTranscript(WT, 'a.jsonl', [duplicate]);
    writeClaudeTranscript(WT, 'b.jsonl', [duplicate]);
    const snapshot = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(snapshot, WT)?.totals.input).toBe(100);
  });

  it('skips malformed and unknown-shape lines without losing the batch', async () => {
    writeClaudeTranscript(WT, 'a.jsonl', [
      '{"truncated":',
      'not json at all',
      JSON.stringify({ type: 'user', cwd: WT }),
      JSON.stringify({ cwd: WT, message: { id: 'x', usage: { tokens_used: 999 } } }),
      claudeUsage({ id: 'm1', requestId: 'r1', input: 42, output: 1 }),
    ]);
    const snapshot = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(snapshot, WT)?.totals.input).toBe(42);
    expect(statusFor(snapshot, 'claude')?.skipped).toBe(2);
  });

  it('does not read transcripts for paths the app does not know', async () => {
    writeClaudeTranscript('/Users/dev/unrelated', 'a.jsonl', [
      claudeUsage({ id: 'm1', cwd: '/Users/dev/unrelated', input: 9999 }),
    ]);
    writeClaudeTranscript(WT, 'a.jsonl', [claudeUsage({ id: 'm2', input: 5 })]);
    const snapshot = await buildTokenUsageSnapshot([WT]);
    expect(snapshot.paths.map((p) => p.path)).toEqual([WT]);
    expect(snapshot.totals.input).toBe(5);
  });

  it('attributes a nested worktree to itself, not to the project above it', async () => {
    writeClaudeTranscript(WT2, 'a.jsonl', [claudeUsage({ id: 'm1', cwd: WT2, input: 77 })]);
    const snapshot = await buildTokenUsageSnapshot([WT, WT2]);
    expect(rowFor(snapshot, WT2)?.totals.input).toBe(77);
    expect(rowFor(snapshot, WT)).toBeUndefined();
  });

  it('attributes a session started in a subdirectory to its worktree', async () => {
    const sub = path.join(WT, 'src', 'lib');
    fs.mkdirSync(sub, { recursive: true });
    const dir = path.join(claudeProjectsDir(), claudeProjectSlug(WT));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'a.jsonl'),
      `${claudeUsage({ id: 'm1', cwd: sub, input: 33 })}\n`,
      'utf8',
    );
    const snapshot = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(snapshot, WT)?.totals.input).toBe(33);
  });

  // Correction five. A removed worktree is its own project's history. Rolling it
  // up into the repo that contained it puts one worktree's spend on another's
  // row, and per-worktree attribution is the whole point of the table.
  it('does not roll a deleted worktree up into the project that contained it', async () => {
    writeClaudeTranscript(WT2, 'a.jsonl', [claudeUsage({ id: 'm1', cwd: WT2, input: 500 })]);
    writeClaudeTranscript(WT, 'b.jsonl', [claudeUsage({ id: 'm2', cwd: WT, input: 7 })]);

    const before = await buildTokenUsageSnapshot([WT, WT2]);
    expect(rowFor(before, WT2)?.totals.input).toBe(500);

    // The worktree is removed. Its transcripts survive; the app no longer lists
    // it, so `/…/project` is the only known path its records could attach to.
    fs.rmSync(WT2, { recursive: true, force: true });
    resetTokenUsageState();

    const after = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(after, WT)?.totals.input).toBe(7);
    expect(after.totals.input).toBe(7);
  });

  // Correction three. Vertex-served Claude Code writes into the same tree.
  it('counts Vertex-served records under their own provider', async () => {
    writeClaudeTranscript(WT, 'a.jsonl', [
      claudeUsage({ id: 'm1', requestId: 'r1', input: 10, output: 1 }),
      claudeUsage({ id: 'm2', requestId: 'req_vrtx_2', input: 40, output: 4 }),
    ]);
    const snapshot = await buildTokenUsageSnapshot([WT]);
    const row = rowFor(snapshot, WT);
    expect(row?.byProvider.claude?.input).toBe(10);
    expect(row?.byProvider['claude-vertex']?.input).toBe(40);
    expect(row?.totals.input).toBe(50);
    // It is not a separate installation, so it gets no status row of its own.
    expect(snapshot.providers.map((p) => p.provider)).toEqual(['claude', 'codex', 'grok']);
  });
});

describe('claude incremental reading', () => {
  it('reads only what was appended and keeps the earlier total', async () => {
    const file = writeClaudeTranscript(WT, 'a.jsonl', [
      claudeUsage({ id: 'm1', requestId: 'r1', input: 100, output: 0 }),
    ]);
    const first = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(first, WT)?.totals.input).toBe(100);

    appendLines(file, [claudeUsage({ id: 'm2', requestId: 'r2', input: 50, output: 0 })]);
    const second = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(second, WT)?.totals.input).toBe(150);
  });

  it('does not double-count when nothing changed between scans', async () => {
    writeClaudeTranscript(WT, 'a.jsonl', [claudeUsage({ id: 'm1', input: 100, output: 0 })]);
    await buildTokenUsageSnapshot([WT]);
    const again = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(again, WT)?.totals.input).toBe(100);
  });

  it('holds a half-written trailing line until its newline arrives', async () => {
    const dir = path.join(claudeProjectsDir(), claudeProjectSlug(WT));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'a.jsonl');
    const complete = claudeUsage({ id: 'm1', requestId: 'r1', input: 100, output: 0 });
    const partial = claudeUsage({ id: 'm2', requestId: 'r2', input: 50, output: 0 });
    fs.writeFileSync(file, `${complete}\n${partial.slice(0, 30)}`, 'utf8');

    const mid = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(mid, WT)?.totals.input).toBe(100);
    expect(statusFor(mid, 'claude')?.skipped).toBe(0);

    fs.appendFileSync(file, `${partial.slice(30)}\n`, 'utf8');
    const done = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(done, WT)?.totals.input).toBe(150);
  });

  it('re-reads from zero when the file is truncated', async () => {
    const file = writeClaudeTranscript(WT, 'a.jsonl', [
      claudeUsage({ id: 'm1', requestId: 'r1', input: 100, output: 0 }),
      claudeUsage({ id: 'm2', requestId: 'r2', input: 100, output: 0 }),
    ]);
    expect(rowFor(await buildTokenUsageSnapshot([WT]), WT)?.totals.input).toBe(200);

    // Truncated in place and rewritten shorter: same inode, smaller size.
    fs.truncateSync(file, 0);
    fs.writeFileSync(file, `${claudeUsage({ id: 'm3', requestId: 'r3', input: 7, output: 0 })}\n`, {
      flag: 'r+',
    });

    const after = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(after, WT)?.totals.input).toBe(7);
  });

  it('re-reads from zero when the file is replaced by a rotation', async () => {
    const file = writeClaudeTranscript(WT, 'a.jsonl', [
      claudeUsage({ id: 'm1', requestId: 'r1', input: 100, output: 0 }),
    ]);
    expect(rowFor(await buildTokenUsageSnapshot([WT]), WT)?.totals.input).toBe(100);

    // Rotation: a different file is renamed over the name, so the inode changes
    // while the size may not have gone down.
    const replacement = `${file}.new`;
    fs.writeFileSync(
      replacement,
      [
        claudeUsage({ id: 'm4', requestId: 'r4', input: 5, output: 0 }),
        claudeUsage({ id: 'm5', requestId: 'r5', input: 5, output: 0 }),
      ]
        .map((l) => `${l}\n`)
        .join(''),
      'utf8',
    );
    fs.renameSync(replacement, file);

    const after = await buildTokenUsageSnapshot([WT]);
    // The rotated-away records are gone from disk, so they are gone from the
    // total; what remains is exactly what the file now contains.
    expect(rowFor(after, WT)?.totals.input).toBe(10);
  });

  it('still counts records the rotated-away copy had already claimed', async () => {
    const file = writeClaudeTranscript(WT, 'a.jsonl', [
      claudeUsage({ id: 'm1', requestId: 'r1', input: 100, output: 0 }),
    ]);
    expect(rowFor(await buildTokenUsageSnapshot([WT]), WT)?.totals.input).toBe(100);

    // The replacement repeats a message id already in the dedupe set. Dedupe is
    // per-directory and must not survive the rotation, or the record vanishes.
    const replacement = `${file}.new`;
    fs.writeFileSync(
      replacement,
      `${claudeUsage({ id: 'm1', requestId: 'r1', input: 100, output: 0 })}\n`,
      'utf8',
    );
    fs.renameSync(replacement, file);

    const after = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(after, WT)?.totals.input).toBe(100);
  });

  it('resets sibling transcripts too, since they share the dedupe set', async () => {
    const a = writeClaudeTranscript(WT, 'a.jsonl', [
      claudeUsage({ id: 'm1', requestId: 'r1', input: 100, output: 0 }),
    ]);
    writeClaudeTranscript(WT, 'b.jsonl', [
      claudeUsage({ id: 'm2', requestId: 'r2', input: 200, output: 0 }),
    ]);
    expect(rowFor(await buildTokenUsageSnapshot([WT]), WT)?.totals.input).toBe(300);

    fs.truncateSync(a, 0);
    fs.writeFileSync(a, `${claudeUsage({ id: 'm3', requestId: 'r3', input: 1, output: 0 })}\n`, {
      flag: 'r+',
    });

    const after = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(after, WT)?.totals.input).toBe(201);
  });
});

describe('codex rollouts', () => {
  it('charges each turn as it happens and splits the cached prefix out of input', async () => {
    writeCodexRollout(WT, 'rollout-a.jsonl', [
      codexTokenCount({ input: 1000, output: 10 }, { input: 1000, output: 10 }, 5000),
      codexTokenCount(
        { input: 5000, cached: 4000, output: 90 },
        { input: 4000, cached: 4000, output: 80 },
        10_000,
      ),
    ]);
    const snapshot = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(snapshot, WT)?.byProvider.codex).toEqual({
      input: 1000,
      output: 90,
      cacheRead: 4000,
      cacheWrite: 0,
    });
  });

  // The reason this wave exists. One codex session, two worktrees.
  it('splits one session between the two worktrees it ran in', async () => {
    writeCodexRollout(WT, 'rollout-a.jsonl', [
      codexTokenCount({ input: 100, output: 10 }, { input: 100, output: 10 }, 5000),
      JSON.stringify({ timestamp: at(8000), type: 'turn_context', payload: { cwd: WT2 } }),
      codexTokenCount({ input: 700, output: 80 }, { input: 600, output: 70 }, 20_000),
    ]);
    const snapshot = await buildTokenUsageSnapshot([WT, WT2]);
    expect(rowFor(snapshot, WT)?.byProvider.codex?.input).toBe(100);
    expect(rowFor(snapshot, WT2)?.byProvider.codex?.input).toBe(600);
    // And the two rows still add up to the session's own cumulative figure.
    expect(snapshot.byProvider.codex?.input).toBe(700);
  });

  it('ignores rollouts whose cwd is not a known worktree', async () => {
    writeCodexRollout(path.join(home, 'other'), 'rollout-a.jsonl', [
      codexTokenCount({ input: 9999, output: 9999 }, { input: 9999, output: 9999 }),
    ]);
    writeCodexRollout(WT, 'rollout-b.jsonl', [
      codexTokenCount({ input: 10, output: 1 }, { input: 10, output: 1 }),
    ]);
    const snapshot = await buildTokenUsageSnapshot([WT]);
    expect(snapshot.paths.map((p) => p.path)).toEqual([WT]);
    expect(rowFor(snapshot, WT)?.totals.input).toBe(10);
  });

  it('adds a rollout that has no token_count yet as nothing, not as a failure', async () => {
    writeCodexRollout(WT, 'rollout-a.jsonl', []);
    const snapshot = await buildTokenUsageSnapshot([WT]);
    expect(statusFor(snapshot, 'codex')?.present).toBe(true);
    expect(snapshot.paths).toEqual([]);
  });

  // R3 read only 8 KB from the front to find `session_meta`. Measured across all
  // 261 rollouts on this machine the first line is 6.3-43.9 KB, because the
  // model's base instructions are embedded in it, so 232 of them — 89% — were
  // truncated mid-line and contributed nothing at all.
  it('finds the working directory in a session_meta far larger than 8 KB', async () => {
    writeCodexRollout(
      WT,
      'rollout-a.jsonl',
      [codexTokenCount({ input: 64, output: 8 }, { input: 64, output: 8 })],
      { base_instructions: 'x'.repeat(40_000) },
    );
    const snapshot = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(snapshot, WT)?.byProvider.codex?.input).toBe(64);
  });

  it('picks up growth without recounting what it already read', async () => {
    const file = writeCodexRollout(WT, 'rollout-a.jsonl', [
      codexTokenCount({ input: 100, output: 10 }, { input: 100, output: 10 }, 5000),
    ]);
    expect(rowFor(await buildTokenUsageSnapshot([WT]), WT)?.totals.input).toBe(100);

    appendLines(file, [
      codexTokenCount({ input: 400, output: 40 }, { input: 300, output: 30 }, 20_000),
    ]);
    const after = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(after, WT)?.byProvider.codex).toEqual({
      input: 400,
      output: 40,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  // Correction two, at the reader level. R3 read a drop as a counter restart and
  // carried the pre-drop value into a base, which charges the first lineage
  // twice. A drop is now read as a second lineage sharing the file.
  it('does not re-count the earlier lineage when the counter goes backwards', async () => {
    const file = writeCodexRollout(WT, 'rollout-a.jsonl', [
      codexTokenCount({ input: 1000, output: 100 }, { input: 1000, output: 100 }, 5000),
    ]);
    await buildTokenUsageSnapshot([WT]);
    appendLines(file, [
      codexTokenCount({ input: 20, output: 2 }, { input: 20, output: 2 }, 20_000),
    ]);
    const after = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(after, WT)?.byProvider.codex).toEqual({
      input: 1020,
      output: 102,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  // Correction four. A subagent rollout opens by replaying its parent's whole
  // history; only the suffix it owns is its own spend.
  it('charges a forked rollout only for the turns it ran itself', async () => {
    writeCodexRollout(
      WT,
      'rollout-a.jsonl',
      [
        codexTokenCount({ input: 5000, output: 500 }, { input: 5000, output: 500 }, 1),
        codexTokenCount({ input: 9000, output: 900 }, { input: 4000, output: 400 }, 4),
        codexTokenCount({ input: 9300, output: 930 }, { input: 300, output: 30 }, 30_000),
      ],
      { forked_from_id: '019f-parent' },
    );
    const snapshot = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(snapshot, WT)?.byProvider.codex?.input).toBe(300);
  });

  it('survives malformed lines', async () => {
    writeCodexRollout(WT, 'rollout-a.jsonl', [
      '{"payload":{"type":"token_count"',
      'garbage line',
      codexTokenCount({ input: 55, cached: 5, output: 5 }, { input: 55, cached: 5, output: 5 }),
    ]);
    const snapshot = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(snapshot, WT)?.byProvider.codex?.input).toBe(50);
    expect(statusFor(snapshot, 'codex')?.skipped).toBe(2);
  });

  it('forgets a rollout that has been deleted', async () => {
    const file = writeCodexRollout(WT, 'rollout-a.jsonl', [
      codexTokenCount({ input: 100, output: 10 }, { input: 100, output: 10 }),
    ]);
    expect(rowFor(await buildTokenUsageSnapshot([WT]), WT)?.totals.input).toBe(100);
    fs.rmSync(file);
    const after = await buildTokenUsageSnapshot([WT]);
    expect(after.paths).toEqual([]);
  });

  it('re-reads a rollout that was rewritten in place', async () => {
    const file = writeCodexRollout(WT, 'rollout-a.jsonl', [
      codexTokenCount({ input: 900, output: 90 }, { input: 900, output: 90 }, 5000),
    ]);
    expect(rowFor(await buildTokenUsageSnapshot([WT]), WT)?.totals.input).toBe(900);

    fs.rmSync(file);
    writeCodexRollout(WT, 'rollout-a.jsonl', [
      codexTokenCount({ input: 7, output: 1 }, { input: 7, output: 1 }, 5000),
    ]);
    const after = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(after, WT)?.totals.input).toBe(7);
  });
});

describe('grok unified log', () => {
  it('joins usage to a worktree through the session id', async () => {
    writeGrokLog([
      JSON.stringify({ sid: 's1', msg: 'session created', ctx: { cwd: WT } }),
      JSON.stringify({ sid: 's2', msg: 'session created', ctx: { cwd: WT2 } }),
      JSON.stringify({
        sid: 's1',
        msg: 'shell.turn.inference_done',
        ctx: { prompt_tokens: 1000, cached_prompt_tokens: 400, completion_tokens: 50 },
      }),
      JSON.stringify({
        sid: 's2',
        msg: 'shell.turn.inference_done',
        ctx: { prompt_tokens: 20, completion_tokens: 2 },
      }),
    ]);
    const snapshot = await buildTokenUsageSnapshot([WT, WT2]);
    expect(rowFor(snapshot, WT)?.byProvider.grok).toEqual({
      input: 600,
      output: 50,
      cacheRead: 400,
      cacheWrite: 0,
    });
    expect(rowFor(snapshot, WT2)?.byProvider.grok?.input).toBe(20);
  });

  it('keeps the session table across incremental reads', async () => {
    const file = writeGrokLog([
      JSON.stringify({ sid: 's1', msg: 'session created', ctx: { cwd: WT } }),
    ]);
    await buildTokenUsageSnapshot([WT]);
    // The `session created` record is now behind the read offset and will never
    // be read again; attribution has to survive on the retained map.
    appendLines(file, [
      JSON.stringify({ sid: 's1', ctx: { prompt_tokens: 90, completion_tokens: 9 } }),
    ]);
    const after = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(after, WT)?.byProvider.grok?.input).toBe(90);
  });

  it('starts over when the log is rotated', async () => {
    const file = writeGrokLog([
      JSON.stringify({ sid: 's1', msg: 'session created', ctx: { cwd: WT } }),
      JSON.stringify({ sid: 's1', ctx: { prompt_tokens: 500, completion_tokens: 50 } }),
    ]);
    expect(rowFor(await buildTokenUsageSnapshot([WT]), WT)?.totals.input).toBe(500);

    const replacement = `${file}.new`;
    fs.writeFileSync(
      replacement,
      [
        JSON.stringify({ sid: 's9', msg: 'session created', ctx: { cwd: WT } }),
        JSON.stringify({ sid: 's9', ctx: { prompt_tokens: 3, completion_tokens: 1 } }),
      ]
        .map((l) => `${l}\n`)
        .join(''),
      'utf8',
    );
    fs.renameSync(replacement, file);

    const after = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(after, WT)?.byProvider.grok?.input).toBe(3);
  });

  it('ignores the auth and model-catalog chatter that fills the log', async () => {
    writeGrokLog([
      JSON.stringify({ ts: 1, msg: 'model catalog: fetching' }),
      JSON.stringify({ sid: 's1', msg: 'auth started', ctx: { has_cached_token: true } }),
      JSON.stringify({ sid: 's1', msg: 'session created', ctx: { cwd: WT } }),
      JSON.stringify({ sid: 's1', ctx: { prompt_tokens: 8, completion_tokens: 1 } }),
    ]);
    const snapshot = await buildTokenUsageSnapshot([WT]);
    expect(statusFor(snapshot, 'grok')?.skipped).toBe(0);
    expect(rowFor(snapshot, WT)?.byProvider.grok?.input).toBe(8);
  });

  it('does not attribute usage for a session it never saw created', async () => {
    writeGrokLog([JSON.stringify({ sid: 'ghost', ctx: { prompt_tokens: 999 } })]);
    const snapshot = await buildTokenUsageSnapshot([WT]);
    expect(snapshot.paths).toEqual([]);
    expect(statusFor(snapshot, 'grok')?.skipped).toBe(1);
  });
});

describe('snapshot shape', () => {
  it('merges the providers under one worktree row', async () => {
    writeClaudeTranscript(WT, 'a.jsonl', [claudeUsage({ id: 'm1', input: 10, output: 1 })]);
    writeCodexRollout(WT, 'rollout-a.jsonl', [
      codexTokenCount({ input: 20, output: 2 }, { input: 20, output: 2 }),
    ]);
    writeGrokLog([
      JSON.stringify({ sid: 's1', ctx: { cwd: WT } }),
      JSON.stringify({ sid: 's1', ctx: { prompt_tokens: 30, completion_tokens: 3 } }),
    ]);

    const snapshot = await buildTokenUsageSnapshot([WT]);
    const row = rowFor(snapshot, WT);
    expect(row?.totals).toEqual({ input: 60, output: 6, cacheRead: 0, cacheWrite: 0 });
    expect(Object.keys(row?.byProvider ?? {}).sort()).toEqual(['claude', 'codex', 'grok']);
    expect(snapshot.byProvider.claude?.input).toBe(10);
    expect(snapshot.updatedAt).toBeGreaterThan(0);
  });

  it('sorts worktrees by total tokens, busiest first', async () => {
    writeClaudeTranscript(WT, 'a.jsonl', [claudeUsage({ id: 'm1', cwd: WT, input: 5 })]);
    writeClaudeTranscript(WT2, 'a.jsonl', [claudeUsage({ id: 'm2', cwd: WT2, input: 500 })]);
    const snapshot = await buildTokenUsageSnapshot([WT, WT2]);
    expect(snapshot.paths.map((p) => p.path)).toEqual([WT2, WT]);
  });

  it('returns an empty snapshot when the app knows no worktrees', async () => {
    writeClaudeTranscript(WT, 'a.jsonl', [claudeUsage({ id: 'm1', input: 10 })]);
    const snapshot = await buildTokenUsageSnapshot([]);
    expect(snapshot.paths).toEqual([]);
    expect(snapshot.totals).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });
});
