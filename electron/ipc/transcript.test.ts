import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_TRANSCRIPT_LIMITS,
  TRANSCRIPT_FORMAT_VERSION,
  TranscriptStore,
  applyTranscriptRetention,
  isTranscriptEnabled,
  normaliseTranscriptEvent,
  parsePersistedTranscriptEnabled,
  parseTranscriptJsonl,
  redactTranscriptEvent,
  sanitiseTranscriptTaskId,
  serialiseTranscriptEvent,
  setTranscriptEnabled,
  type TranscriptEvent,
  type TranscriptLimits,
} from './transcript.js';

// The switch is module-level state shared by every suite in this file. Both
// hooks run so a test never inherits a value and never leaves one behind — the
// same discipline offline.test.ts uses, and the reason these tests pass when
// run alone as well as inside the full suite.
beforeEach(() => setTranscriptEnabled(false));
afterEach(() => setTranscriptEnabled(false));

const DAY_MS = 24 * 60 * 60 * 1000;

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pc-transcript-'));
}

function event(over: Partial<TranscriptEvent> = {}): TranscriptEvent {
  return {
    v: TRANSCRIPT_FORMAT_VERSION,
    ts: '2026-07-31T03:00:00.000Z',
    taskId: 'task-1',
    kind: 'step',
    status: 'implementing',
    summary: 'wired the writer',
    ...over,
  };
}

describe('the switch itself', () => {
  it('is off by default, so an upgrade records nothing until asked', () => {
    expect(isTranscriptEnabled()).toBe(false);
  });

  it('is reversible', () => {
    setTranscriptEnabled(true);
    expect(isTranscriptEnabled()).toBe(true);
    setTranscriptEnabled(false);
    expect(isTranscriptEnabled()).toBe(false);
  });
});

describe('parsePersistedTranscriptEnabled', () => {
  it('reads the switch out of a state.json payload', () => {
    expect(parsePersistedTranscriptEnabled('{"transcriptEnabled":true}')).toBe(true);
    expect(parsePersistedTranscriptEnabled('{"transcriptEnabled":false}')).toBe(false);
  });

  it('treats an absent field as off, so upgrading keeps prior behaviour', () => {
    expect(parsePersistedTranscriptEnabled('{"tasks":{}}')).toBe(false);
  });

  it('requires a literal true — a truthy value is a corrupt file, not consent', () => {
    expect(parsePersistedTranscriptEnabled('{"transcriptEnabled":"yes"}')).toBe(false);
    expect(parsePersistedTranscriptEnabled('{"transcriptEnabled":1}')).toBe(false);
  });

  it('survives unreadable input rather than throwing during startup', () => {
    expect(parsePersistedTranscriptEnabled(null)).toBe(false);
    expect(parsePersistedTranscriptEnabled(undefined)).toBe(false);
    expect(parsePersistedTranscriptEnabled('')).toBe(false);
    expect(parsePersistedTranscriptEnabled('not json')).toBe(false);
    expect(parsePersistedTranscriptEnabled('[]')).toBe(false);
  });
});

describe('sanitiseTranscriptTaskId', () => {
  it('accepts the ids the app actually mints', () => {
    expect(sanitiseTranscriptTaskId('0f1c2d3e-4a5b-6c7d-8e9f-a0b1c2d3e4f5')).not.toBeNull();
  });

  it('refuses anything that could escape the transcript directory', () => {
    expect(sanitiseTranscriptTaskId('../../etc/passwd')).toBeNull();
    expect(sanitiseTranscriptTaskId('a/b')).toBeNull();
    expect(sanitiseTranscriptTaskId('..')).toBeNull();
    expect(sanitiseTranscriptTaskId('.')).toBeNull();
    expect(sanitiseTranscriptTaskId('')).toBeNull();
    expect(sanitiseTranscriptTaskId(42)).toBeNull();
    expect(sanitiseTranscriptTaskId('x'.repeat(129))).toBeNull();
  });
});

describe('normaliseTranscriptEvent', () => {
  const now = new Date('2026-07-31T03:00:00.000Z');

  it('stamps the timestamp in main and ignores whatever the renderer claimed', () => {
    const e = normaliseTranscriptEvent(
      {
        taskId: 't1',
        kind: 'agent',
        status: 'spawned',
        summary: 'claude started',
        ts: '1999-01-01',
      },
      now,
    );
    expect(e?.ts).toBe('2026-07-31T03:00:00.000Z');
  });

  it('rejects an unknown kind rather than inventing vocabulary', () => {
    expect(
      normaliseTranscriptEvent({ taskId: 't1', kind: 'telemetry', status: 'x', summary: 'y' }, now),
    ).toBeNull();
  });

  it('rejects malformed input instead of throwing into the IPC dispatch path', () => {
    expect(normaliseTranscriptEvent(null, now)).toBeNull();
    expect(normaliseTranscriptEvent('nope', now)).toBeNull();
    expect(normaliseTranscriptEvent([], now)).toBeNull();
    expect(normaliseTranscriptEvent({ taskId: 't1', kind: 'step' }, now)).toBeNull();
    expect(
      normaliseTranscriptEvent({ taskId: '../x', kind: 'step', status: 's', summary: 'y' }, now),
    ).toBeNull();
  });

  it('clips oversized fields so one runaway event cannot dominate a file', () => {
    const e = normaliseTranscriptEvent(
      { taskId: 't1', kind: 'step', status: 'done', summary: 'x'.repeat(10_000) },
      now,
    );
    expect(e?.summary.length).toBeLessThan(600);
  });
});

describe('JSONL round-trip', () => {
  it('survives a write and read of every field', () => {
    const original = event({ detail: 'src/a.ts, src/b.ts', redacted: ['jwt'] });
    const parsed = parseTranscriptJsonl(serialiseTranscriptEvent(original));
    expect(parsed.skipped).toBe(0);
    expect(parsed.events).toEqual([original]);
  });

  it('keeps multi-line detail on one line, so the format stays line-delimited', () => {
    const line = serialiseTranscriptEvent(event({ detail: 'first\nsecond\nthird' }));
    expect(line.split('\n').filter((l) => l.length > 0)).toHaveLength(1);
    expect(parseTranscriptJsonl(line).events[0].detail).toBe('first\nsecond\nthird');
  });

  it('preserves order across many events', () => {
    const events = Array.from({ length: 50 }, (_, i) => event({ summary: `step ${i}` }));
    const body = events.map(serialiseTranscriptEvent).join('');
    expect(parseTranscriptJsonl(body).events.map((e) => e.summary)).toEqual(
      events.map((e) => e.summary),
    );
  });
});

describe('malformed-line tolerance', () => {
  it('costs one event, never the file — a torn tail is a normal end state', () => {
    const good = serialiseTranscriptEvent(event({ summary: 'before' }));
    const torn = '{"ts":"2026-07-31T03:00:00.000Z","taskId":"task-1","kind":"ste';
    const after = serialiseTranscriptEvent(event({ summary: 'after' }));
    const parsed = parseTranscriptJsonl(good + torn + '\n' + after);
    expect(parsed.events.map((e) => e.summary)).toEqual(['before', 'after']);
    expect(parsed.skipped).toBe(1);
  });

  it('drops well-formed JSON that is not an event', () => {
    const parsed = parseTranscriptJsonl('{"hello":"world"}\n[]\n"a string"\n42\nnull\n');
    expect(parsed.events).toHaveLength(0);
    expect(parsed.skipped).toBe(5);
  });

  it('ignores blank lines without counting them as damage', () => {
    const parsed = parseTranscriptJsonl('\n\n' + serialiseTranscriptEvent(event()) + '\n\n');
    expect(parsed.events).toHaveLength(1);
    expect(parsed.skipped).toBe(0);
  });
});

describe('retention — both rules apply, whichever bites first', () => {
  const now = new Date('2026-07-31T00:00:00.000Z');
  const limits: TranscriptLimits = { maxEvents: 5, maxAgeMs: 30 * DAY_MS, compactionSlack: 2 };

  it('keeps the newest maxEvents when the count cap bites first', () => {
    const events = Array.from({ length: 12 }, (_, i) =>
      event({ summary: `e${i}`, ts: new Date(now.getTime() - 1000).toISOString() }),
    );
    const kept = applyTranscriptRetention(events, limits, now);
    expect(kept.map((e) => e.summary)).toEqual(['e7', 'e8', 'e9', 'e10', 'e11']);
  });

  it('drops events past the age window even when the count is far under the cap', () => {
    const kept = applyTranscriptRetention(
      [
        event({ summary: 'ancient', ts: new Date(now.getTime() - 31 * DAY_MS).toISOString() }),
        event({ summary: 'recent', ts: new Date(now.getTime() - 1 * DAY_MS).toISOString() }),
      ],
      limits,
      now,
    );
    expect(kept.map((e) => e.summary)).toEqual(['recent']);
  });

  it('applies the age window before the count, so an old event cannot occupy a slot', () => {
    const events = [
      ...Array.from({ length: 4 }, (_, i) =>
        event({ summary: `old${i}`, ts: new Date(now.getTime() - 40 * DAY_MS).toISOString() }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        event({ summary: `new${i}`, ts: new Date(now.getTime() - 1000).toISOString() }),
      ),
    ];
    expect(applyTranscriptRetention(events, limits, now).map((e) => e.summary)).toEqual([
      'new0',
      'new1',
      'new2',
    ]);
  });

  it('treats an unparseable timestamp as expired — it can never age out otherwise', () => {
    const kept = applyTranscriptRetention([event({ ts: 'not-a-date' })], limits, now);
    expect(kept).toHaveLength(0);
  });

  it('ships the documented defaults: 5000 events per task, 30 days globally', () => {
    expect(DEFAULT_TRANSCRIPT_LIMITS.maxEvents).toBe(5000);
    expect(DEFAULT_TRANSCRIPT_LIMITS.maxAgeMs).toBe(30 * DAY_MS);
  });
});

describe('TranscriptStore — the default-off promise', () => {
  it('writes nothing at all while the switch is off, not even the directory', () => {
    const dir = path.join(tmpDir(), 'transcripts');
    const store = new TranscriptStore(dir);

    for (let i = 0; i < 10; i++) {
      expect(store.append(event({ summary: `never written ${i}` }))).toBe(false);
    }

    // The strongest form of the claim: the directory the writer would have
    // created does not exist, so there is no file to inspect, empty or not.
    expect(fs.existsSync(dir)).toBe(false);
    expect(store.read('task-1')).toEqual([]);
  });

  it('starts recording only once the switch is flipped on', () => {
    const dir = path.join(tmpDir(), 'transcripts');
    const store = new TranscriptStore(dir);
    store.append(event({ summary: 'dropped' }));
    setTranscriptEnabled(true);
    store.append(event({ summary: 'kept' }));
    expect(store.read('task-1').map((e) => e.summary)).toEqual(['kept']);
  });
});

describe('TranscriptStore — writing and reading', () => {
  beforeEach(() => setTranscriptEnabled(true));

  it('round-trips events through a real file on disk', () => {
    const store = new TranscriptStore(path.join(tmpDir(), 'transcripts'));
    store.append(event({ summary: 'first', kind: 'agent', status: 'spawned' }));
    store.append(event({ summary: 'second', kind: 'merge', status: 'merged', detail: '+12/-3' }));

    const read = store.read('task-1');
    expect(read.map((e) => e.summary)).toEqual(['first', 'second']);
    expect(read[1].detail).toBe('+12/-3');
    expect(read[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('keeps one file per task', () => {
    const dir = path.join(tmpDir(), 'transcripts');
    const store = new TranscriptStore(dir);
    store.append(event({ taskId: 'alpha', summary: 'a' }));
    store.append(event({ taskId: 'beta', summary: 'b' }));
    expect(fs.readdirSync(dir).sort()).toEqual(['alpha.jsonl', 'beta.jsonl']);
    expect(store.read('alpha').map((e) => e.summary)).toEqual(['a']);
  });

  it('returns an empty list for a task that was never recorded', () => {
    const store = new TranscriptStore(path.join(tmpDir(), 'transcripts'));
    expect(store.read('never-seen')).toEqual([]);
  });

  it('refuses a task id that would escape the directory', () => {
    const dir = path.join(tmpDir(), 'transcripts');
    const store = new TranscriptStore(dir);
    expect(store.append(event({ taskId: '../escape' }))).toBe(false);
    expect(store.read('../escape')).toEqual([]);
  });

  it('reads back a file a previous process left behind — restart does not lose it', () => {
    const dir = path.join(tmpDir(), 'transcripts');
    new TranscriptStore(dir).append(event({ summary: 'from the last run' }));
    expect(new TranscriptStore(dir).read('task-1').map((e) => e.summary)).toEqual([
      'from the last run',
    ]);
  });
});

describe('TranscriptStore — rotation', () => {
  beforeEach(() => setTranscriptEnabled(true));

  const limits: TranscriptLimits = { maxEvents: 10, maxAgeMs: 30 * DAY_MS, compactionSlack: 5 };

  it('compacts the file back to the cap once slack is exhausted', () => {
    const dir = path.join(tmpDir(), 'transcripts');
    const store = new TranscriptStore(dir, limits);
    for (let i = 0; i < 40; i++) store.append(event({ summary: `e${i}` }));

    const onDisk = fs
      .readFileSync(path.join(dir, 'task-1.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.length > 0);
    // Never unbounded, and never larger than cap + slack.
    expect(onDisk.length).toBeLessThanOrEqual(limits.maxEvents + limits.compactionSlack);
    expect(store.read('task-1')).toHaveLength(limits.maxEvents);
  });

  it('keeps the newest events, discarding the oldest', () => {
    const store = new TranscriptStore(path.join(tmpDir(), 'transcripts'), limits);
    for (let i = 0; i < 40; i++) store.append(event({ summary: `e${i}` }));
    expect(store.read('task-1').map((e) => e.summary)).toEqual([
      'e30',
      'e31',
      'e32',
      'e33',
      'e34',
      'e35',
      'e36',
      'e37',
      'e38',
      'e39',
    ]);
  });

  it('caps what a reader sees even when the file transiently holds more', () => {
    const dir = path.join(tmpDir(), 'transcripts');
    const store = new TranscriptStore(dir, limits);
    for (let i = 0; i < 13; i++) store.append(event({ summary: `e${i}` }));
    // 13 lines is inside cap+slack, so no compaction ran yet…
    const lines = fs
      .readFileSync(path.join(dir, 'task-1.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(13);
    // …and the read still honours the cap exactly.
    expect(store.read('task-1')).toHaveLength(10);
  });

  it('survives a compaction pass over a file containing damaged lines', () => {
    const dir = path.join(tmpDir(), 'transcripts');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'task-1.jsonl');
    fs.writeFileSync(file, 'garbage\n' + serialiseTranscriptEvent(event({ summary: 'kept' })));

    const store = new TranscriptStore(dir, limits);
    store.compact('task-1');
    expect(store.read('task-1').map((e) => e.summary)).toEqual(['kept']);
  });
});

describe('TranscriptStore — the 30-day sweep', () => {
  beforeEach(() => setTranscriptEnabled(true));

  it('deletes a file whose every event has aged out', () => {
    const dir = path.join(tmpDir(), 'transcripts');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'stale.jsonl'),
      serialiseTranscriptEvent(event({ taskId: 'stale', ts: '2020-01-01T00:00:00.000Z' })),
    );

    const store = new TranscriptStore(dir);
    expect(store.sweep(new Date('2026-07-31T00:00:00.000Z'))).toBe(1);
    expect(fs.existsSync(path.join(dir, 'stale.jsonl'))).toBe(false);
  });

  it('trims rather than deletes a file that is only partly stale', () => {
    const dir = path.join(tmpDir(), 'transcripts');
    const now = new Date('2026-07-31T00:00:00.000Z');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'mixed.jsonl'),
      serialiseTranscriptEvent(
        event({ taskId: 'mixed', summary: 'old', ts: '2020-01-01T00:00:00.000Z' }),
      ) +
        serialiseTranscriptEvent(
          event({
            taskId: 'mixed',
            summary: 'fresh',
            ts: new Date(now.getTime() - DAY_MS).toISOString(),
          }),
        ),
    );

    const store = new TranscriptStore(dir);
    store.sweep(now);
    expect(store.read('mixed', now).map((e) => e.summary)).toEqual(['fresh']);
  });

  it('leaves a wholly fresh file alone', () => {
    const dir = path.join(tmpDir(), 'transcripts');
    const store = new TranscriptStore(dir);
    store.append(event({ summary: 'today' }));
    expect(store.sweep()).toBe(0);
    expect(store.read('task-1')).toHaveLength(1);
  });
});

describe('TranscriptStore — clear', () => {
  beforeEach(() => setTranscriptEnabled(true));

  it('removes every transcript and reports how many went', () => {
    const dir = path.join(tmpDir(), 'transcripts');
    const store = new TranscriptStore(dir);
    store.append(event({ taskId: 'a', summary: 'x' }));
    store.append(event({ taskId: 'b', summary: 'y' }));

    expect(store.clear()).toBe(2);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(store.read('a')).toEqual([]);
  });

  it('is a no-op on a directory that was never created', () => {
    expect(new TranscriptStore(path.join(tmpDir(), 'nothing-here')).clear()).toBe(0);
  });
});

describe('redaction happens before the write, not after', () => {
  beforeEach(() => setTranscriptEnabled(true));

  // The whole point of the ordering. If redaction ran after the write — or on
  // export — the bytes would already have hit the filesystem, and a later
  // rewrite would not unmake them. So the assertion is deliberately made
  // against the raw file, not against what read() hands back.
  it('never lets a secret reach the file, only the marker', () => {
    const dir = path.join(tmpDir(), 'transcripts');
    const store = new TranscriptStore(dir);
    const fakeKey = 'sk-ant-' + 'A'.repeat(64);

    store.append(event({ summary: `exported ANTHROPIC_API_KEY=${fakeKey}` }));

    const raw = fs.readFileSync(path.join(dir, 'task-1.jsonl'), 'utf8');
    expect(raw).not.toContain(fakeKey);
    expect(raw).toContain('[REDACTED:');
  });

  it('redacts detail as well as summary', () => {
    const dir = path.join(tmpDir(), 'transcripts');
    const store = new TranscriptStore(dir);
    const fakeToken = 'ghp_' + 'b'.repeat(36);

    store.append(event({ summary: 'pushed', detail: `used ${fakeToken} to authenticate` }));

    const raw = fs.readFileSync(path.join(dir, 'task-1.jsonl'), 'utf8');
    expect(raw).not.toContain(fakeToken);
    expect(store.read('task-1')[0].detail).toContain('[REDACTED:github-token]');
  });

  it('records which rules fired, so the timeline can say something was masked', () => {
    const store = new TranscriptStore(path.join(tmpDir(), 'transcripts'));
    store.append(event({ summary: `key sk-ant-${'C'.repeat(64)}` }));
    expect(store.read('task-1')[0].redacted).toEqual(['anthropic-api-key']);
  });

  it('leaves an ordinary event untouched and unmarked', () => {
    const store = new TranscriptStore(path.join(tmpDir(), 'transcripts'));
    store.append(event({ summary: 'refactored the parser', detail: 'src/parse.ts' }));
    const read = store.read('task-1')[0];
    expect(read.summary).toBe('refactored the parser');
    expect(read.redacted).toBeUndefined();
  });
});

describe('redactTranscriptEvent', () => {
  it('returns the event unchanged when nothing matched', () => {
    const e = event({ summary: 'nothing secret here' });
    expect(redactTranscriptEvent(e)).toBe(e);
  });

  it('deduplicates rule ids across summary and detail', () => {
    const e = event({
      summary: `a sk-ant-${'D'.repeat(64)}`,
      detail: `b sk-ant-${'E'.repeat(64)}`,
    });
    expect(redactTranscriptEvent(e).redacted).toEqual(['anthropic-api-key']);
  });
});
