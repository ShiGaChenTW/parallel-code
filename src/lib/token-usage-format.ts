// Display helpers for the token usage table.
//
// Split out of the component because vitest runs `environment: 'node'` with no
// DOM harness — a SolidJS component cannot be rendered in a test here, so every
// judgement the table makes lives in a pure function that can be.

import type { ProviderId, TokenTotals, TokenUsagePathRow } from '../ipc/types';

export const TOKEN_PROVIDERS: readonly ProviderId[] = [
  'claude',
  'claude-vertex',
  'codex',
  'grok',
  'agy',
];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: 'Claude',
  'claude-vertex': 'Claude (Vertex)',
  codex: 'Codex',
  grok: 'Grok',
  // Invoked as `agy`, but it calls itself Antigravity everywhere a user reads
  // it, so the column does too.
  agy: 'Antigravity',
};

/**
 * Abbreviates a token count.
 *
 * These numbers reach the hundreds of millions, where the digits stop carrying
 * information and only the magnitude is read. Three significant figures below
 * 100 and none above keeps every cell the same width, so columns line up
 * without a monospace font doing the work.
 */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  const units: [number, string][] = [
    [1_000_000_000, 'B'],
    [1_000_000, 'M'],
    [1_000, 'k'],
  ];
  for (const [size, suffix] of units) {
    if (value >= size) {
      const scaled = value / size;
      return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1)}${suffix}`;
    }
  }
  return String(Math.round(value));
}

export function sumTokenTotals(totals: TokenTotals): number {
  return totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
}

/**
 * The label for a worktree row.
 *
 * Absolute paths are long and share a prefix, so the tail is what distinguishes
 * them. Two components are kept rather than one, because sibling worktrees
 * commonly differ only in the last segment of the parent.
 */
export function shortenPath(absolutePath: string): string {
  const parts = absolutePath.split('/').filter(Boolean);
  if (parts.length <= 2) return absolutePath;
  return parts.slice(-2).join('/');
}

export interface ProviderColumn {
  provider: ProviderId;
  label: string;
}

/**
 * Which provider columns the table shows.
 *
 * A CLI the user does not run should not occupy a column of zeroes, so columns
 * appear only for providers that actually contributed. When none did, the
 * caller renders the empty state instead of a header with nothing under it.
 */
export function visibleProviderColumns(rows: readonly TokenUsagePathRow[]): ProviderColumn[] {
  const used = new Set<ProviderId>();
  for (const row of rows) {
    for (const provider of TOKEN_PROVIDERS) {
      const totals = row.byProvider[provider];
      if (totals && sumTokenTotals(totals) > 0) used.add(provider);
    }
  }
  return TOKEN_PROVIDERS.filter((p) => used.has(p)).map((p) => ({
    provider: p,
    label: PROVIDER_LABELS[p],
  }));
}

/**
 * Segment colours for the per-worktree share bar.
 *
 * Fixed hex rather than theme variables: the bar's job is to tell five vendors
 * apart at a glance, and the theme exposes one accent plus three semantic
 * colours (success/warning/error) whose meanings would be borrowed wrongly here
 * — a red segment would read as a failure rather than as Grok. The five are
 * mid-tone on purpose so they hold contrast against both the light and the dark
 * panel background without a per-theme table.
 *
 * Not used by the settings table, which is deliberately colourless: there the
 * provider is a column header, and a colour would be decoration. Here it is the
 * only thing linking a bar segment to its legend row.
 */
export const PROVIDER_COLORS: Record<ProviderId, string> = {
  claude: '#d97757',
  'claude-vertex': '#e0a33e',
  codex: '#4a9d7f',
  grok: '#5b8def',
  agy: '#a86fd8',
};

/** One provider's slice of a single worktree's spend. */
export interface UsageShare {
  provider: ProviderId;
  label: string;
  color: string;
  tokens: number;
  /** Fraction of the worktree's provider total, 0–1. */
  share: number;
}

/**
 * Why a worktree has nothing to draw, or that it does.
 *
 * `no-worktree` and `no-usage` are separated because they need different
 * sentences: the first is "there is no line yet", the second is "the line is
 * real and has cost nothing so far". Collapsing them would leave a brand-new
 * task and a never-run task looking identical.
 */
export type WorktreeUsageState = 'no-worktree' | 'no-usage' | 'ok';

export interface WorktreeUsage {
  state: WorktreeUsageState;
  /** Every counter for this worktree, summed. */
  total: number;
  totals: TokenTotals;
  /** Biggest contributor first. Providers that spent nothing are absent. */
  shares: UsageShare[];
}

const NO_TOKENS: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/**
 * One worktree's slice of the global snapshot.
 *
 * Matches on the exact path rather than a prefix. Sibling worktrees routinely
 * share one, and `/repo/.worktrees/feature` is a prefix of
 * `/repo/.worktrees/feature-2` — a prefix match would silently fold the second
 * into the first and overstate the number the user is reading.
 *
 * `share` is computed against the sum of the per-provider counts, not against
 * `totals`. The two agree in practice, and when they cannot the bar still fills
 * exactly rather than leaving a gap that looks like a rendering fault.
 */
export function worktreeUsage(
  rows: readonly TokenUsagePathRow[],
  worktreePath: string | undefined,
): WorktreeUsage {
  if (!worktreePath) {
    return { state: 'no-worktree', total: 0, totals: NO_TOKENS, shares: [] };
  }
  const row = rows.find((candidate) => candidate.path === worktreePath);
  const totals = row?.totals ?? NO_TOKENS;
  const total = sumTokenTotals(totals);

  const contributions = TOKEN_PROVIDERS.map((provider) => ({
    provider,
    tokens: sumTokenTotals(row?.byProvider[provider] ?? NO_TOKENS),
  })).filter((entry) => entry.tokens > 0);

  const providerTotal = contributions.reduce((sum, entry) => sum + entry.tokens, 0);
  const shares: UsageShare[] = contributions
    .sort((a, b) => b.tokens - a.tokens)
    .map((entry) => ({
      provider: entry.provider,
      label: PROVIDER_LABELS[entry.provider],
      color: PROVIDER_COLORS[entry.provider],
      tokens: entry.tokens,
      share: entry.tokens / providerTotal,
    }));

  const state: WorktreeUsageState = total > 0 || shares.length > 0 ? 'ok' : 'no-usage';
  return { state, total, totals, shares };
}

/**
 * A 0–1 fraction as a percentage label.
 *
 * A contributor rounding to `0%` while sitting visibly in the bar reads as a
 * bug, so anything non-zero below half a percent is written `<1%` instead.
 */
export function formatShare(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return '0%';
  const percent = share * 100;
  return percent < 0.5 ? '<1%' : `${Math.round(percent)}%`;
}

/** One sentence the caller translates: source text plus the values it carries. */
export interface ProviderSummarySentence {
  readonly text: string;
  readonly params: Readonly<Record<string, string>>;
}

/**
 * The line summarising which CLIs were found, one sentence at a time.
 *
 * A missing directory means the CLI is not installed, which is ordinary and is
 * worded as such — the alternative, showing nothing, leaves the user unable to
 * tell "not installed" from "broken". A genuine read error is called out
 * separately because that one is worth acting on.
 *
 * Returns descriptors rather than a finished string, matching
 * `dependencyBlockMessage`, for two reasons. `tr()` reads `store.locale` and so
 * is not pure, and this module has to stay testable without a store. And the
 * version this replaces built each sentence by concatenation, which pinned the
 * provider list to the position English puts it in; `{providers}` lets the
 * translation move it — zh-TW wants "未安裝 Codex" where English wants "Codex
 * not installed".
 */
export function describeProviders(
  providers: readonly { provider: ProviderId; present: boolean; error?: string }[],
): ProviderSummarySentence[] {
  if (providers.length === 0) return [{ text: 'No usage logs have been read yet.', params: {} }];
  const label = (p: { provider: ProviderId }) => PROVIDER_LABELS[p.provider];
  const found = providers.filter((p) => p.present && !p.error).map(label);
  const failed = providers.filter((p) => p.error).map(label);
  const missing = providers.filter((p) => !p.present && !p.error).map(label);

  const sentences: ProviderSummarySentence[] = [
    found.length > 0
      ? { text: 'Reading {providers}.', params: { providers: found.join(', ') } }
      : { text: 'No AI CLI logs found.', params: {} },
  ];
  if (missing.length > 0) {
    sentences.push({
      text: '{providers} not installed.',
      params: { providers: missing.join(', ') },
    });
  }
  if (failed.length > 0) {
    sentences.push({
      text: 'Could not read {providers}.',
      params: { providers: failed.join(', ') },
    });
  }
  return sentences;
}
