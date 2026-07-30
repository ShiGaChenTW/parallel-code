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

const WT = '/Users/dev/project';
const WT2 = '/Users/dev/project/.worktrees/feature';

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

function writeCodexRollout(cwd: string, name: string, extra: string[]): string {
  const dir = path.join(codexSessionsDir(), '2026', '07', '31');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  const lines = [JSON.stringify({ type: 'session_meta', payload: { cwd } }), ...extra];
  fs.writeFileSync(file, lines.map((l) => `${l}\n`).join(''), 'utf8');
  return file;
}

function codexTokenCount(input: number, cached: number, output: number): string {
  return JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output,
          total_tokens: input + output,
        },
      },
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
    const dir = path.join(claudeProjectsDir(), claudeProjectSlug(WT));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'a.jsonl'),
      `${claudeUsage({ id: 'm1', cwd: `${WT}/src/lib`, input: 33 })}\n`,
      'utf8',
    );
    const snapshot = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(snapshot, WT)?.totals.input).toBe(33);
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
  it('takes the last cumulative total and splits the cached prefix out of input', async () => {
    writeCodexRollout(WT, 'rollout-a.jsonl', [
      codexTokenCount(1000, 0, 10),
      codexTokenCount(5000, 4000, 90),
    ]);
    const snapshot = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(snapshot, WT)?.byProvider.codex).toEqual({
      input: 1000,
      output: 90,
      cacheRead: 4000,
      cacheWrite: 0,
    });
  });

  it('ignores rollouts whose cwd is not a known worktree', async () => {
    writeCodexRollout('/Users/dev/other', 'rollout-a.jsonl', [codexTokenCount(9999, 0, 9999)]);
    writeCodexRollout(WT, 'rollout-b.jsonl', [codexTokenCount(10, 0, 1)]);
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

  it('picks up growth without double counting the cumulative value', async () => {
    const file = writeCodexRollout(WT, 'rollout-a.jsonl', [codexTokenCount(100, 0, 10)]);
    expect(rowFor(await buildTokenUsageSnapshot([WT]), WT)?.totals.input).toBe(100);

    appendLines(file, [codexTokenCount(400, 0, 40)]);
    const after = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(after, WT)?.byProvider.codex).toEqual({
      input: 400,
      output: 40,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it('carries the pre-restart total when the cumulative counter goes backwards', async () => {
    const file = writeCodexRollout(WT, 'rollout-a.jsonl', [codexTokenCount(1000, 0, 100)]);
    await buildTokenUsageSnapshot([WT]);
    appendLines(file, [codexTokenCount(20, 0, 2)]);
    const after = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(after, WT)?.byProvider.codex).toEqual({
      input: 1020,
      output: 102,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it('survives malformed lines in the tail', async () => {
    writeCodexRollout(WT, 'rollout-a.jsonl', [
      '{"payload":{"type":"token_count"',
      'garbage line',
      codexTokenCount(55, 5, 5),
    ]);
    const snapshot = await buildTokenUsageSnapshot([WT]);
    expect(rowFor(snapshot, WT)?.byProvider.codex?.input).toBe(50);
    expect(statusFor(snapshot, 'codex')?.skipped).toBe(2);
  });

  it('forgets a rollout that has been deleted', async () => {
    const file = writeCodexRollout(WT, 'rollout-a.jsonl', [codexTokenCount(100, 0, 10)]);
    expect(rowFor(await buildTokenUsageSnapshot([WT]), WT)?.totals.input).toBe(100);
    fs.rmSync(file);
    const after = await buildTokenUsageSnapshot([WT]);
    expect(after.paths).toEqual([]);
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
    writeCodexRollout(WT, 'rollout-a.jsonl', [codexTokenCount(20, 0, 2)]);
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
