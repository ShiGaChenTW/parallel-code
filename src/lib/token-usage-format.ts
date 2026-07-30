// Display helpers for the token usage table.
//
// Split out of the component because vitest runs `environment: 'node'` with no
// DOM harness — a SolidJS component cannot be rendered in a test here, so every
// judgement the table makes lives in a pure function that can be.

import type { ProviderId, TokenTotals, TokenUsagePathRow } from '../ipc/types';

export const TOKEN_PROVIDERS: readonly ProviderId[] = ['claude', 'codex', 'grok'];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  grok: 'Grok',
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
 * One line summarising which CLIs were found.
 *
 * A missing directory means the CLI is not installed, which is ordinary and is
 * worded as such — the alternative, showing nothing, leaves the user unable to
 * tell "not installed" from "broken". A genuine read error is called out
 * separately because that one is worth acting on.
 */
export function describeProviders(
  providers: readonly { provider: ProviderId; present: boolean; error?: string }[],
): string {
  if (providers.length === 0) return 'No usage logs have been read yet.';
  const found = providers
    .filter((p) => p.present && !p.error)
    .map((p) => PROVIDER_LABELS[p.provider]);
  const failed = providers.filter((p) => p.error).map((p) => PROVIDER_LABELS[p.provider]);
  const missing = providers
    .filter((p) => !p.present && !p.error)
    .map((p) => PROVIDER_LABELS[p.provider]);

  const parts: string[] = [];
  parts.push(found.length > 0 ? `Reading ${found.join(', ')}.` : 'No AI CLI logs found.');
  if (missing.length > 0) parts.push(`${missing.join(', ')} not installed.`);
  if (failed.length > 0) parts.push(`Could not read ${failed.join(', ')}.`);
  return parts.join(' ');
}
