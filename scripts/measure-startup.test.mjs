import { describe, expect, it } from 'vitest';
import {
  elapsedFromSpawn,
  formatSummary,
  median,
  parseStartupMarks,
  summarize,
} from './measure-startup.mjs';

const line = (mark, atMs) =>
  `[21:37:08.600] DEBUG startup — startup mark {"mark":"${mark}","atMs":${atMs}}`;

describe('parseStartupMarks', () => {
  it('extracts every mark with its absolute timestamp', () => {
    const marks = parseStartupMarks(
      [
        line('main-module-loaded', 1000),
        line('app-ready', 1300),
        line('window-created', 1340),
      ].join('\n'),
    );
    expect(marks).toEqual({
      'main-module-loaded': 1000,
      'app-ready': 1300,
      'window-created': 1340,
    });
  });

  it('keeps the first occurrence so a reload cannot overwrite a startup value', () => {
    const marks = parseStartupMarks(
      [line('renderer-loaded', 1500), line('renderer-loaded', 9999)].join('\n'),
    );
    expect(marks['renderer-loaded']).toBe(1500);
  });

  it('ignores unrelated log lines', () => {
    const marks = parseStartupMarks('[21:37:08.600] INFO pty — spawn command {"taskId":"t1"}');
    expect(marks).toEqual({});
  });

  it('skips a truncated line rather than throwing', () => {
    const marks = parseStartupMarks(
      `startup mark {"mark":"app-ready","atM\n${line('app-ready', 42)}`,
    );
    expect(marks).toEqual({ 'app-ready': 42 });
  });

  it('rejects a payload whose atMs is not a number', () => {
    expect(parseStartupMarks('startup mark {"mark":"app-ready","atMs":"soon"}')).toEqual({});
  });
});

describe('elapsedFromSpawn', () => {
  it('measures from the spawn timestamp, not from the first mark', () => {
    const elapsed = elapsedFromSpawn({ 'main-module-loaded': 1200, 'app-ready': 1500 }, 1000);
    expect(elapsed['main-module-loaded']).toBe(200);
    expect(elapsed['app-ready']).toBe(500);
  });

  it('reports null for marks that never arrived', () => {
    expect(elapsedFromSpawn({}, 1000)['renderer-loaded']).toBeNull();
  });
});

describe('median', () => {
  it('takes the middle value of an odd-length set', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('averages the middle pair of an even-length set', () => {
    expect(median([1, 2, 3, 4])).toBe(3);
  });

  it('returns null when nothing was measured', () => {
    expect(median([null, undefined])).toBeNull();
  });
});

describe('summarize', () => {
  it('counts only the runs that reported a mark', () => {
    const summary = summarize([
      { 'app-ready': 100, 'renderer-loaded': 400 },
      { 'app-ready': 200, 'renderer-loaded': null },
    ]);
    const appReady = summary.find((row) => row.mark === 'app-ready');
    const rendererLoaded = summary.find((row) => row.mark === 'renderer-loaded');
    expect(appReady).toMatchObject({ n: 2, median: 150, min: 100, max: 200 });
    expect(rendererLoaded).toMatchObject({ n: 1, median: 400 });
  });
});

describe('formatSummary', () => {
  it('flags marks that were missing from some runs instead of hiding it', () => {
    const report = formatSummary(summarize([{ 'app-ready': 100 }, {}]), 2);
    expect(report).toContain('only 1/2 runs');
  });

  it('shows the spread so a noisy measurement is visible', () => {
    const report = formatSummary(summarize([{ 'app-ready': 100 }, { 'app-ready': 300 }]), 2);
    expect(report).toContain('(100–300)');
  });
});
