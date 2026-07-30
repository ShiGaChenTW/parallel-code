// Pure-parsing contract for `.claude/handoff.md`.
//
// The watcher around this function is untestable in a node-only vitest run
// (fs.watch + Electron BrowserWindow), so every decision that can be made
// without IO lives here instead: what counts as "no handoff", what an agent's
// byte-level sloppiness (BOM, CRLF) should normalise to, and where the size
// ceiling sits. See steps.test.ts for the same split on `.claude/steps.json`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_HANDOFF_BYTES, parseHandoffContent, readHandoffForWorktree } from './handoff.js';

// Built from code points rather than written literally: a raw BOM or NUL in
// source is invisible in review and survives a careless copy-paste.
const BOM = String.fromCharCode(0xfeff);
const NUL = String.fromCharCode(0);
const REPLACEMENT = String.fromCharCode(0xfffd);

describe('parseHandoffContent', () => {
  it('returns markdown prose unchanged', () => {
    const raw = '# Handoff\n\nThe auth refactor is done. Start at `src/auth/session.ts`.\n';
    expect(parseHandoffContent(raw)).toBe(raw);
  });

  it('treats a missing-but-created empty file as no handoff', () => {
    expect(parseHandoffContent('')).toBeNull();
  });

  it('treats a whitespace-only file as no handoff', () => {
    // An agent that touches the file before writing must not surface an empty tab.
    for (const blank of ['   ', '\n\n\n', '\t\n \n', '\r\n\r\n']) {
      expect(parseHandoffContent(blank), JSON.stringify(blank)).toBeNull();
    }
  });

  it('strips a UTF-8 BOM so the first heading still parses as a heading', () => {
    expect(parseHandoffContent(`${BOM}# Handoff\n`)).toBe('# Handoff\n');
  });

  it('normalises CRLF and lone CR to LF', () => {
    expect(parseHandoffContent('# Handoff\r\n\r\nDone.\r\n')).toBe('# Handoff\n\nDone.\n');
    expect(parseHandoffContent('a\rb')).toBe('a\nb');
  });

  it('rejects binary content rather than feeding NUL bytes to the renderer', () => {
    expect(parseHandoffContent(`# Handoff\n${NUL}binary`)).toBeNull();
  });

  it('keeps content that sits exactly on the byte ceiling intact', () => {
    const exact = 'x'.repeat(MAX_HANDOFF_BYTES);
    expect(parseHandoffContent(exact)).toBe(exact);
  });

  it('truncates oversized content and says so in the rendered output', () => {
    const oversized = `${'x'.repeat(MAX_HANDOFF_BYTES)}yyyy`;
    const parsed = parseHandoffContent(oversized);
    expect(parsed).not.toBeNull();
    expect(parsed).toContain('truncated');
    expect(Buffer.byteLength(parsed as string, 'utf8')).toBeLessThan(MAX_HANDOFF_BYTES + 200);
  });

  it('never splits a multi-byte character when truncating', () => {
    // A file of 3-byte characters guarantees the ceiling lands mid-character.
    const parsed = parseHandoffContent('漢'.repeat(MAX_HANDOFF_BYTES));
    expect(parsed).not.toBeNull();
    expect(parsed).not.toContain(REPLACEMENT);
  });

  it('truncates at a line boundary so the cut never lands mid-sentence', () => {
    const line = `${'x'.repeat(99)}\n`;
    const parsed = parseHandoffContent(line.repeat(Math.ceil(MAX_HANDOFF_BYTES / 100) + 10));
    expect(parsed).not.toBeNull();
    const body = (parsed as string).split('\n> ')[0];
    for (const l of body.split('\n').filter(Boolean)) {
      expect(l).toHaveLength(99);
    }
  });
});

/**
 * `readHandoffForWorktree` is what IPC.ReadHandoffContent calls, and that IPC
 * is the entire restart story: handoffContent is never persisted (see the plan
 * doc, D4), so after an app restart the Handoff tab is rebuilt by re-reading
 * the worktree file. These exercise it against a real filesystem so "it comes
 * back after a restart" is verified rather than assumed.
 */
describe('readHandoffForWorktree — the restart path', () => {
  let worktree: string;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-worktree-'));
    fs.mkdirSync(path.join(worktree, '.claude'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(worktree, { recursive: true, force: true });
  });

  function writeHandoff(contents: string): void {
    fs.writeFileSync(path.join(worktree, '.claude', 'handoff.md'), contents, 'utf-8');
  }

  it('returns the handoff a previous session left behind', () => {
    writeHandoff('# Handoff\n\nAuth is done; start at `src/auth/session.ts`.\n');
    expect(readHandoffForWorktree(worktree)).toBe(
      '# Handoff\n\nAuth is done; start at `src/auth/session.ts`.\n',
    );
  });

  it('returns null when the file was never written', () => {
    expect(readHandoffForWorktree(worktree)).toBeNull();
  });

  it('returns null when `.claude/` itself does not exist', () => {
    fs.rmSync(path.join(worktree, '.claude'), { recursive: true });
    expect(readHandoffForWorktree(worktree)).toBeNull();
  });

  it('returns null for an empty file, so no tab appears', () => {
    writeHandoff('');
    expect(readHandoffForWorktree(worktree)).toBeNull();
  });

  it('returns null for a whitespace-only file', () => {
    writeHandoff('\n   \n');
    expect(readHandoffForWorktree(worktree)).toBeNull();
  });

  it('survives a file the agent wrote with CRLF endings', () => {
    writeHandoff('# Handoff\r\n\r\nDone.\r\n');
    expect(readHandoffForWorktree(worktree)).toBe('# Handoff\n\nDone.\n');
  });

  it('does not throw when the path is not a worktree at all', () => {
    expect(readHandoffForWorktree(path.join(worktree, 'nope', 'nowhere'))).toBeNull();
  });
});
