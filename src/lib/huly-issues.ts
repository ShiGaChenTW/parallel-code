import type { HulyIssue } from '../ipc/types';

/**
 * Pure joins between Huly issues and local tasks.
 *
 * Kept out of the store and out of components so it is testable under
 * `environment: 'node'` — the picker UI itself has no test harness, so the part
 * that can be wrong in an interesting way lives here instead.
 */

/** How long a cached issue list is considered fresh. */
export const ISSUE_CACHE_TTL_MS = 60_000;

export function isIssueCacheStale(fetchedAt: number, now: number, ttlMs = ISSUE_CACHE_TTL_MS) {
  if (fetchedAt <= 0) return true;
  // A clock that moved backwards must not make a cache look fresh forever.
  if (fetchedAt > now) return true;
  return now - fetchedAt >= ttlMs;
}

/** Ids of Huly issues already linked to a task. */
export function linkedIssueIds(tasks: { hulyIssueId?: string }[]): Set<string> {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (task.hulyIssueId) ids.add(task.hulyIssueId);
  }
  return ids;
}

export interface PartitionedIssues {
  /** No task yet — these are the ones worth starting work on. */
  unstarted: HulyIssue[];
  /** Already has a task in this app. */
  started: HulyIssue[];
}

/**
 * Split issues by whether a task already exists for them.
 *
 * The picker leads with `unstarted` because the feature is "start work on an
 * issue"; showing an issue that already has a worktree invites a duplicate.
 */
export function partitionIssues(issues: HulyIssue[], linked: Set<string>): PartitionedIssues {
  const unstarted: HulyIssue[] = [];
  const started: HulyIssue[] = [];
  for (const issue of issues) {
    (linked.has(issue.id) ? started : unstarted).push(issue);
  }
  return { unstarted, started };
}

/** Case-insensitive match on identifier or title, for the picker's filter box. */
export function filterIssues(issues: HulyIssue[], query: string): HulyIssue[] {
  const q = query.trim().toLowerCase();
  if (q === '') return issues;
  return issues.filter(
    (issue) => issue.identifier.toLowerCase().includes(q) || issue.title.toLowerCase().includes(q),
  );
}

/**
 * Branch name for a task started from an issue: the identifier, lowercased,
 * with everything git dislikes collapsed to a single hyphen.
 *
 * Only the identifier is used, never the title — titles contain characters git
 * refuses and change after the branch exists, and `FK_PC-6` is already unique.
 */
export function branchNameForIssue(identifier: string): string {
  const slug = identifier
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? '' : `issue/${slug}`;
}

/** Task name shown in the sidebar for an issue-started task. */
export function taskNameForIssue(issue: Pick<HulyIssue, 'identifier' | 'title'>): string {
  const title = issue.title.trim();
  return title === '' ? issue.identifier : `${issue.identifier} ${title}`;
}
