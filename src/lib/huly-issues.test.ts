import { describe, expect, it } from 'vitest';
import {
  branchNameForIssue,
  filterIssues,
  isIssueCacheStale,
  linkedIssueIds,
  partitionIssues,
  taskNameForIssue,
  ISSUE_CACHE_TTL_MS,
} from './huly-issues';
import type { HulyIssue } from '../ipc/types';

const issue = (over: Partial<HulyIssue> = {}): HulyIssue => ({
  id: 'i1',
  identifier: 'FK_PC-1',
  title: 'Remove monaco',
  status: 'tracker:status:Done',
  modifiedOn: 1,
  ...over,
});

describe('isIssueCacheStale', () => {
  it('treats a never-fetched cache as stale', () => {
    expect(isIssueCacheStale(0, 1_000)).toBe(true);
  });

  it('keeps a recent cache fresh', () => {
    expect(isIssueCacheStale(1_000, 1_000 + ISSUE_CACHE_TTL_MS - 1)).toBe(false);
  });

  it('goes stale exactly at the TTL', () => {
    expect(isIssueCacheStale(1_000, 1_000 + ISSUE_CACHE_TTL_MS)).toBe(true);
  });

  it('treats a future timestamp as stale so a backwards clock cannot freeze the cache', () => {
    expect(isIssueCacheStale(5_000, 1_000)).toBe(true);
  });
});

describe('linkedIssueIds', () => {
  it('collects the ids of tasks that link an issue', () => {
    expect(linkedIssueIds([{ hulyIssueId: 'a' }, {}, { hulyIssueId: 'b' }])).toEqual(
      new Set(['a', 'b']),
    );
  });

  it('is empty when nothing is linked', () => {
    expect(linkedIssueIds([{}, {}]).size).toBe(0);
  });
});

describe('partitionIssues', () => {
  it('separates issues that already have a task', () => {
    const a = issue({ id: 'a' });
    const b = issue({ id: 'b' });
    const result = partitionIssues([a, b], new Set(['b']));
    expect(result.unstarted).toEqual([a]);
    expect(result.started).toEqual([b]);
  });

  it('preserves the incoming order within each group', () => {
    const list = [issue({ id: '1' }), issue({ id: '2' }), issue({ id: '3' })];
    expect(partitionIssues(list, new Set()).unstarted.map((i) => i.id)).toEqual(['1', '2', '3']);
  });
});

describe('filterIssues', () => {
  const list = [
    issue({ id: '1', identifier: 'FK_PC-1', title: 'Remove monaco' }),
    issue({ id: '2', identifier: 'FK_PC-2', title: 'Send raw bytes' }),
  ];

  it('returns everything for an empty or whitespace query', () => {
    expect(filterIssues(list, '')).toHaveLength(2);
    expect(filterIssues(list, '   ')).toHaveLength(2);
  });

  it('matches the identifier case-insensitively', () => {
    expect(filterIssues(list, 'fk_pc-2').map((i) => i.id)).toEqual(['2']);
  });

  it('matches the title', () => {
    expect(filterIssues(list, 'monaco').map((i) => i.id)).toEqual(['1']);
  });

  it('returns nothing when there is no match, rather than falling back to everything', () => {
    expect(filterIssues(list, 'nothing matches this')).toEqual([]);
  });
});

describe('branchNameForIssue', () => {
  it('builds a git-safe branch from the identifier', () => {
    expect(branchNameForIssue('FK_PC-6')).toBe('issue/fk-pc-6');
  });

  it('collapses runs of unsafe characters into one hyphen', () => {
    expect(branchNameForIssue('AB__//CD')).toBe('issue/ab-cd');
  });

  it('trims leading and trailing hyphens, which git rejects in a ref', () => {
    expect(branchNameForIssue('--X--')).toBe('issue/x');
  });

  it('returns empty for an identifier with nothing usable, so the caller can fall back', () => {
    expect(branchNameForIssue('///')).toBe('');
  });
});

describe('taskNameForIssue', () => {
  it('combines identifier and title', () => {
    expect(taskNameForIssue({ identifier: 'FK_PC-6', title: 'Read path' })).toBe(
      'FK_PC-6 Read path',
    );
  });

  it('falls back to the identifier when the title is blank', () => {
    expect(taskNameForIssue({ identifier: 'FK_PC-6', title: '   ' })).toBe('FK_PC-6');
  });
});
