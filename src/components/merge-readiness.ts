import type { MergeStatus, PrChecksOverall, WorktreeStatus } from '../ipc/types';
import type { TranslationParams } from '../lib/i18n';
import type { SubtaskVerification, SubtaskVerificationCheck } from '../store/types';

export type MergeReadinessCheckStatus = 'pass' | 'warning' | 'blocked' | 'checking' | 'neutral';

/**
 * One sentence for the caller to translate: source text plus the values it
 * carries.
 *
 * This module is pure and stays that way. `tr()` reads `store.locale`, so
 * calling it here would tie every judgement below to a store the tests do not
 * have — vitest runs `environment: 'node'`, and this file exists precisely so
 * the judgements can be asserted without a component or a store.
 *
 * Descriptors rather than finished strings, matching `describeProviders` and
 * `dependencyBlockMessage`. The version this replaces built each sentence by
 * concatenation (`${count} conflicting file` + ' must be resolved.'), which
 * pinned every one of them to the word order English happens to use;
 * `{count}` lets the translation put the value where zh-TW wants it.
 */
export interface MergeReadinessMessage {
  readonly text: string;
  readonly params?: TranslationParams;
}

export interface MergeReadinessCheck {
  /** Catalogue key for the row label, translated by the panel. */
  label: string;
  status: MergeReadinessCheckStatus;
  detail: MergeReadinessMessage;
}

export interface MergeReadiness {
  overall: 'ready' | 'attention' | 'blocked' | 'checking';
  checks: MergeReadinessCheck[];
}

interface PrReadinessState {
  overall: PrChecksOverall;
  passing: number;
  pending: number;
  failing: number;
}

export interface MergeReadinessInput {
  expectedBranch: string;
  mergeStatus?: MergeStatus;
  mergeStatusLoading: boolean;
  worktreeStatus?: WorktreeStatus;
  worktreeStatusLoading: boolean;
  verification?: SubtaskVerification;
  prChecks?: PrReadinessState;
}

/**
 * Pick the sentence English needs for `count`.
 *
 * Not plural machinery: zh-TW has no plural form, so both keys map to the same
 * translation. It exists so each wording is a whole catalogue entry — the same
 * ternary-between-sentences idiom the rest of the UI already uses — rather than
 * a noun glued onto a number.
 */
function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function mergeSafetyCheck(input: MergeReadinessInput): MergeReadinessCheck {
  if (input.mergeStatusLoading || input.worktreeStatusLoading) {
    return {
      label: 'Merge safety',
      status: 'checking',
      detail: { text: 'Checking merge safety…' },
    };
  }

  const merge = input.mergeStatus;
  const worktree = input.worktreeStatus;
  if (worktree) {
    // One block rather than the two guards this replaces, so `current` narrows
    // to a string for the interpolated sentence. Same order, same outcomes:
    // a detached HEAD is reported before a plain mismatch.
    const current = worktree.current_branch;
    if (current === null) {
      return {
        label: 'Merge safety',
        status: 'blocked',
        detail: { text: 'Worktree has a detached HEAD.' },
      };
    }
    if (current !== input.expectedBranch) {
      return {
        label: 'Merge safety',
        status: 'blocked',
        detail: {
          text: "Worktree is on '{current}', expected '{expected}'.",
          params: { current, expected: input.expectedBranch },
        },
      };
    }
  }
  if (merge && merge.conflicting_files.length > 0) {
    return {
      label: 'Merge safety',
      status: 'blocked',
      detail: {
        text: plural(
          merge.conflicting_files.length,
          '{count} conflicting file must be resolved.',
          '{count} conflicting files must be resolved.',
        ),
        params: { count: merge.conflicting_files.length },
      },
    };
  }
  if (worktree && !worktree.has_committed_changes) {
    return {
      label: 'Merge safety',
      status: 'blocked',
      detail: { text: 'No committed changes are available to merge.' },
    };
  }
  if (!merge || !worktree) {
    return {
      label: 'Merge safety',
      status: 'warning',
      detail: { text: 'Merge safety could not be checked.' },
    };
  }
  if (merge.main_ahead_count > 0) {
    return {
      label: 'Merge safety',
      status: 'warning',
      detail: {
        text: plural(
          merge.main_ahead_count,
          '{branch} is {count} commit ahead. Rebase recommended.',
          '{branch} is {count} commits ahead. Rebase recommended.',
        ),
        params: { branch: merge.base_branch, count: merge.main_ahead_count },
      },
    };
  }
  if (worktree.has_uncommitted_changes) {
    return {
      label: 'Merge safety',
      status: 'warning',
      detail: { text: 'Uncommitted changes will be excluded.' },
    };
  }
  return { label: 'Merge safety', status: 'pass', detail: { text: 'Branch is mergeable.' } };
}

/**
 * The sentence for a verification check that did not pass.
 *
 * `blocked` and `failed` are separate wordings rather than one sentence with the
 * result word substituted in. Substituting it would leave an untranslated
 * English word sitting inside a Chinese sentence — the half-translated reading
 * this wave exists to remove.
 */
function verificationFailureDetail(check: SubtaskVerificationCheck): MergeReadinessMessage {
  const blocked = check.result === 'blocked';
  if (check.reason) {
    return {
      text: blocked ? '{name} blocked — {reason}' : '{name} failed — {reason}',
      params: { name: check.name, reason: check.reason },
    };
  }
  return {
    text: blocked ? '{name} blocked' : '{name} failed',
    params: { name: check.name },
  };
}

function verificationCheck(verification?: SubtaskVerification): MergeReadinessCheck {
  if (!verification?.checks.length) {
    return {
      label: 'Verification',
      status: 'warning',
      detail: { text: 'No verification was reported.' },
    };
  }
  const failed = verification.checks.find((check) => check.result !== 'passed');
  if (failed) {
    return {
      label: 'Verification',
      status: 'warning',
      detail: verificationFailureDetail(failed),
    };
  }
  return {
    label: 'Verification',
    status: 'pass',
    detail: {
      text: plural(verification.checks.length, '{count} check passed.', '{count} checks passed.'),
      params: { count: verification.checks.length },
    },
  };
}

function prCheck(prChecks?: PrReadinessState): MergeReadinessCheck {
  if (!prChecks || prChecks.overall === 'none') {
    return { label: 'PR checks', status: 'neutral', detail: { text: 'No PR checks available.' } };
  }
  if (prChecks.overall === 'pending') {
    return {
      label: 'PR checks',
      status: 'warning',
      detail: prChecks.failing
        ? {
            text: '{pending} pending, {passing} passing, {failing} failing.',
            params: {
              pending: prChecks.pending,
              passing: prChecks.passing,
              failing: prChecks.failing,
            },
          }
        : {
            text: '{pending} pending, {passing} passing.',
            params: { pending: prChecks.pending, passing: prChecks.passing },
          },
    };
  }
  if (prChecks.overall === 'failure') {
    return {
      label: 'PR checks',
      status: 'warning',
      detail: prChecks.pending
        ? {
            text: '{failing} failing, {passing} passing, {pending} pending.',
            params: {
              failing: prChecks.failing,
              passing: prChecks.passing,
              pending: prChecks.pending,
            },
          }
        : {
            text: '{failing} failing, {passing} passing.',
            params: { failing: prChecks.failing, passing: prChecks.passing },
          },
    };
  }
  return {
    label: 'PR checks',
    status: 'pass',
    detail: {
      text: plural(prChecks.passing, '{count} check passed.', '{count} checks passed.'),
      params: { count: prChecks.passing },
    },
  };
}

export function buildMergeReadiness(input: MergeReadinessInput): MergeReadiness {
  const checks = [
    mergeSafetyCheck(input),
    verificationCheck(input.verification),
    prCheck(input.prChecks),
  ];
  const overall = checks.some((check) => check.status === 'blocked')
    ? 'blocked'
    : checks.some((check) => check.status === 'checking')
      ? 'checking'
      : checks.some((check) => check.status === 'warning')
        ? 'attention'
        : 'ready';
  return { overall, checks };
}
