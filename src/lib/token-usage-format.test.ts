import { describe, expect, it } from 'vitest';

import {
  describeProviders,
  formatTokens,
  shortenPath,
  sumTokenTotals,
  visibleProviderColumns,
} from './token-usage-format';
import type { TokenUsagePathRow } from '../ipc/types';

const t = (input: number, output = 0, cacheRead = 0, cacheWrite = 0) => ({
  input,
  output,
  cacheRead,
  cacheWrite,
});

describe('formatTokens', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [999, '999'],
    [1000, '1.0k'],
    [1500, '1.5k'],
    [99_900, '99.9k'],
    [150_000, '150k'],
    [1_000_000, '1.0M'],
    [527_759_700, '528M'],
    [1_500_000_000, '1.5B'],
  ])('formats %d as %s', (value, expected) => {
    expect(formatTokens(value)).toBe(expected);
  });

  it('treats nonsense as zero rather than rendering NaN', () => {
    expect(formatTokens(NaN)).toBe('0');
    expect(formatTokens(-5)).toBe('0');
    expect(formatTokens(Infinity)).toBe('0');
  });
});

describe('sumTokenTotals', () => {
  it('adds all four counters', () => {
    expect(sumTokenTotals(t(1, 2, 3, 4))).toBe(10);
  });
});

describe('shortenPath', () => {
  it('keeps the last two components', () => {
    expect(shortenPath('/Users/dev/Documents/Projects/parallel-code')).toBe(
      'Projects/parallel-code',
    );
  });

  it('distinguishes sibling worktrees', () => {
    expect(shortenPath('/repo/.worktrees/feature-a')).not.toBe(
      shortenPath('/repo/.worktrees/feature-b'),
    );
  });

  it('leaves a short path alone', () => {
    expect(shortenPath('/repo')).toBe('/repo');
    expect(shortenPath('/a/b')).toBe('/a/b');
  });
});

describe('visibleProviderColumns', () => {
  const row = (byProvider: TokenUsagePathRow['byProvider']): TokenUsagePathRow => ({
    path: '/repo',
    totals: t(1),
    byProvider,
  });

  it('shows only providers that contributed', () => {
    const columns = visibleProviderColumns([row({ claude: t(10), grok: t(5) })]);
    expect(columns.map((c) => c.provider)).toEqual(['claude', 'grok']);
  });

  it('keeps a stable provider order regardless of row order', () => {
    const columns = visibleProviderColumns([row({ grok: t(1) }), row({ claude: t(1) })]);
    expect(columns.map((c) => c.provider)).toEqual(['claude', 'grok']);
  });

  it('hides a provider whose totals are all zero', () => {
    expect(visibleProviderColumns([row({ codex: t(0) })])).toEqual([]);
  });

  it('returns nothing for no rows', () => {
    expect(visibleProviderColumns([])).toEqual([]);
  });
});

describe('describeProviders', () => {
  it('names the CLIs it read', () => {
    expect(
      describeProviders([
        { provider: 'claude', present: true },
        { provider: 'codex', present: true },
        { provider: 'grok', present: true },
      ]),
    ).toBe('Reading Claude, Codex, Grok.');
  });

  it('says a missing CLI is not installed rather than treating it as a fault', () => {
    expect(
      describeProviders([
        { provider: 'claude', present: true },
        { provider: 'codex', present: false },
      ]),
    ).toBe('Reading Claude. Codex not installed.');
  });

  it('calls out a genuine read failure separately', () => {
    expect(
      describeProviders([
        { provider: 'claude', present: true },
        { provider: 'grok', present: true, error: 'EACCES' },
      ]),
    ).toBe('Reading Claude. Could not read Grok.');
  });

  it('handles nothing installed at all', () => {
    expect(
      describeProviders([
        { provider: 'claude', present: false },
        { provider: 'codex', present: false },
        { provider: 'grok', present: false },
      ]),
    ).toBe('No AI CLI logs found. Claude, Codex, Grok not installed.');
  });

  it('handles an empty provider list', () => {
    expect(describeProviders([])).toBe('No usage logs have been read yet.');
  });
});
