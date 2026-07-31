import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { translate } from '../lib/i18n';
import type { MergeStatus, WorktreeStatus } from '../ipc/types';
import type { SubtaskVerification } from '../store/types';
import { MergeReadinessPanel } from './MergeReadinessPanel';
import {
  buildMergeReadiness,
  type MergeReadinessCheck,
  type MergeReadinessInput,
} from './merge-readiness';

const cleanMergeStatus: MergeStatus = {
  main_ahead_count: 0,
  conflicting_files: [],
  base_branch: 'main',
};

const cleanWorktreeStatus: WorktreeStatus = {
  has_committed_changes: true,
  has_uncommitted_changes: false,
  current_branch: 'task/readiness',
};

const passedVerification: SubtaskVerification = {
  checks: [
    { name: 'typecheck', command: 'npm run typecheck', result: 'passed' },
    { name: 'test', command: 'npm test', result: 'passed' },
  ],
};

function input(overrides: Partial<MergeReadinessInput> = {}): MergeReadinessInput {
  return {
    expectedBranch: 'task/readiness',
    mergeStatus: cleanMergeStatus,
    mergeStatusLoading: false,
    worktreeStatus: cleanWorktreeStatus,
    worktreeStatusLoading: false,
    verification: passedVerification,
    ...overrides,
  };
}

/**
 * The English sentence a check's detail renders to.
 *
 * `buildMergeReadiness` returns a `{ text, params }` descriptor rather than a
 * finished string, because it is pure and `tr()` reads the store. The
 * assertions below are still written as the sentence a user reads: the English
 * catalogue is empty by construction, so `translate('en', …)` is interpolation
 * and nothing else, and the exact wording this file pinned before there was a
 * translation layer is still what fails when it changes.
 */
function detail(check: MergeReadinessCheck): string {
  return translate('en', check.detail.text, check.detail.params);
}

describe('buildMergeReadiness', () => {
  it('reports ready when merge safety and reported verification pass', () => {
    const readiness = buildMergeReadiness(input());

    expect(readiness.overall).toBe('ready');
    expect(readiness.checks).toEqual([
      expect.objectContaining({ label: 'Merge safety', status: 'pass' }),
      expect.objectContaining({ label: 'Verification', status: 'pass' }),
      expect.objectContaining({ label: 'PR checks', status: 'neutral' }),
    ]);
  });

  it('reports checking while merge data is loading', () => {
    const readiness = buildMergeReadiness(
      input({ mergeStatus: undefined, mergeStatusLoading: true }),
    );

    expect(readiness.overall).toBe('checking');
    expect(readiness.checks[0].status).toBe('checking');
    expect(detail(readiness.checks[0])).toBe('Checking merge safety…');
  });

  it.each([
    {
      name: 'conflicting files',
      overrides: {
        mergeStatus: { ...cleanMergeStatus, conflicting_files: ['src/App.tsx'] },
      },
      detail: '1 conflicting file must be resolved.',
    },
    {
      name: 'a mismatched branch',
      overrides: {
        worktreeStatus: { ...cleanWorktreeStatus, current_branch: 'task/other' },
      },
      detail: "Worktree is on 'task/other', expected 'task/readiness'.",
    },
    {
      name: 'no committed changes',
      overrides: {
        worktreeStatus: { ...cleanWorktreeStatus, has_committed_changes: false },
      },
      detail: 'No committed changes are available to merge.',
    },
  ])('reports not ready for $name', ({ overrides, detail: expected }) => {
    const readiness = buildMergeReadiness(input(overrides));

    expect(readiness.overall).toBe('blocked');
    expect(readiness.checks[0].status).toBe('blocked');
    expect(detail(readiness.checks[0])).toBe(expected);
  });

  it.each([
    {
      name: 'a detached HEAD when merge status is unavailable',
      overrides: {
        mergeStatus: undefined,
        worktreeStatus: { ...cleanWorktreeStatus, current_branch: null },
      },
      detail: 'Worktree has a detached HEAD.',
    },
    {
      name: 'conflicts when worktree status is unavailable',
      overrides: {
        mergeStatus: { ...cleanMergeStatus, conflicting_files: ['src/App.tsx'] },
        worktreeStatus: undefined,
      },
      detail: '1 conflicting file must be resolved.',
    },
  ])('preserves the known blocker for $name', ({ overrides, detail: expected }) => {
    const readiness = buildMergeReadiness(input(overrides));

    expect(readiness.overall).toBe('blocked');
    expect(readiness.checks[0].status).toBe('blocked');
    expect(detail(readiness.checks[0])).toBe(expected);
  });

  it('reports attention for uncommitted changes and missing verification', () => {
    const readiness = buildMergeReadiness(
      input({
        worktreeStatus: { ...cleanWorktreeStatus, has_uncommitted_changes: true },
        verification: undefined,
      }),
    );

    expect(readiness.overall).toBe('attention');
    expect(readiness.checks[0].status).toBe('warning');
    expect(detail(readiness.checks[0])).toBe('Uncommitted changes will be excluded.');
    expect(readiness.checks[1].status).toBe('warning');
    expect(detail(readiness.checks[1])).toBe('No verification was reported.');
  });

  it('reports attention for failing verification and pending PR checks', () => {
    const readiness = buildMergeReadiness(
      input({
        verification: {
          checks: [
            {
              name: 'test',
              command: 'npm test',
              result: 'failed',
              reason: '2 tests failed',
            },
          ],
        },
        prChecks: { overall: 'pending', passing: 2, pending: 1, failing: 0 },
      }),
    );

    expect(readiness.overall).toBe('attention');
    expect(readiness.checks[1].status).toBe('warning');
    expect(detail(readiness.checks[1])).toBe('test failed — 2 tests failed');
    expect(readiness.checks[2].status).toBe('warning');
    expect(detail(readiness.checks[2])).toBe('1 pending, 2 passing.');
  });

  it('includes failures while PR checks are still pending', () => {
    const readiness = buildMergeReadiness(
      input({
        prChecks: { overall: 'pending', passing: 2, pending: 1, failing: 1 },
      }),
    );

    expect(readiness.overall).toBe('attention');
    expect(readiness.checks[2].status).toBe('warning');
    expect(detail(readiness.checks[2])).toBe('1 pending, 2 passing, 1 failing.');
  });

  it('words a blocked verification differently from a failed one', () => {
    // The result used to be substituted into one sentence, which would leave a
    // bare English 'blocked' sitting inside a Chinese line. Two wordings
    // instead, so each is a whole entry the translator owns.
    const readiness = buildMergeReadiness(
      input({
        verification: { checks: [{ name: 'lint', command: 'npm run lint', result: 'blocked' }] },
      }),
    );

    expect(readiness.checks[1].status).toBe('warning');
    expect(detail(readiness.checks[1])).toBe('lint blocked');
  });

  it('hands the panel a template and its values, not a finished sentence', () => {
    // The point of the descriptor: the count is a `{count}` slot, so the
    // translation decides where it lands rather than inheriting the position
    // English concatenation gave it. Two English keys because English inflects
    // the noun; zh-TW maps both to one sentence.
    const one = buildMergeReadiness(
      input({ mergeStatus: { ...cleanMergeStatus, conflicting_files: ['a.ts'] } }),
    );
    const many = buildMergeReadiness(
      input({ mergeStatus: { ...cleanMergeStatus, conflicting_files: ['a.ts', 'b.ts'] } }),
    );

    expect(one.checks[0].detail).toEqual({
      text: '{count} conflicting file must be resolved.',
      params: { count: 1 },
    });
    expect(many.checks[0].detail).toEqual({
      text: '{count} conflicting files must be resolved.',
      params: { count: 2 },
    });
    expect(detail(many.checks[0])).toBe('2 conflicting files must be resolved.');
  });
});

describe('MergeReadinessPanel', () => {
  it('renders an accessible textual summary without relying on status color', () => {
    const readiness = buildMergeReadiness(input());
    const html = renderToString(() => MergeReadinessPanel({ readiness }));

    expect(html).toContain('aria-label="Ready to merge summary"');
    expect(html).toContain('Ready to merge');
    expect(html).toContain('Merge safety');
    expect(html).toContain('Verification');
    expect(html).toContain('2 checks passed.');
    expect(html).toContain('PR checks');
    expect(html).toContain('No PR checks available.');
    expect(html).toContain(
      'title="Ready means every available check passed. Needs attention means a warning; Not ready means a merge-safety blocker; Checking means merge data is loading. This summary is advisory."',
    );
    expect(html).toContain(
      'title="Checks the task branch for conflicts with its base branch, branch mismatch, committed changes, and local uncommitted changes."',
    );
    expect(html).toContain(
      'title="Uses structured verification reported by land_self, such as tests or typechecking. Without a report this needs attention; opening the dialog never runs commands."',
    );
    expect(html).toContain(
      'title="Uses checks reported for a detected GitHub pull request. Pull requests are optional, and unavailable check data is neutral."',
    );
  });
});
