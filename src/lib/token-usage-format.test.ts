import { describe, expect, it } from 'vitest';

import {
  describeProviders,
  formatTokens,
  shortenPath,
  sumTokenTotals,
  visibleProviderColumns,
} from './token-usage-format';
import { translate, type Locale } from './i18n';
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

  // Vertex-served Claude is a separate account against a separate quota, so it
  // gets a column of its own — and, like every other provider, only once it has
  // actually contributed. There are none on this machine, so the ordinary case
  // is that the column never appears.
  it('gives Vertex-served Claude its own labelled column beside Claude', () => {
    const columns = visibleProviderColumns([row({ claude: t(10), 'claude-vertex': t(5) })]);
    expect(columns.map((c) => c.provider)).toEqual(['claude', 'claude-vertex']);
    expect(columns.map((c) => c.label)).toEqual(['Claude', 'Claude (Vertex)']);
  });

  it('shows no Vertex column when nothing was served by Vertex', () => {
    expect(visibleProviderColumns([row({ claude: t(10) })]).map((c) => c.provider)).toEqual([
      'claude',
    ]);
  });

  it('returns nothing for no rows', () => {
    expect(visibleProviderColumns([])).toEqual([]);
  });
});

describe('describeProviders', () => {
  /** What the component renders: every descriptor translated, then joined. */
  const line = (locale: Locale, providers: Parameters<typeof describeProviders>[0]): string =>
    describeProviders(providers)
      .map((sentence) => translate(locale, sentence.text, sentence.params))
      .join(' ');

  it('names the CLIs it read', () => {
    expect(
      line('en', [
        { provider: 'claude', present: true },
        { provider: 'codex', present: true },
        { provider: 'grok', present: true },
      ]),
    ).toBe('Reading Claude, Codex, Grok.');
  });

  it('says a missing CLI is not installed rather than treating it as a fault', () => {
    expect(
      line('en', [
        { provider: 'claude', present: true },
        { provider: 'codex', present: false },
      ]),
    ).toBe('Reading Claude. Codex not installed.');
  });

  it('calls out a genuine read failure separately', () => {
    expect(
      line('en', [
        { provider: 'claude', present: true },
        { provider: 'grok', present: true, error: 'EACCES' },
      ]),
    ).toBe('Reading Claude. Could not read Grok.');
  });

  it('handles nothing installed at all', () => {
    expect(
      line('en', [
        { provider: 'claude', present: false },
        { provider: 'codex', present: false },
        { provider: 'grok', present: false },
      ]),
    ).toBe('No AI CLI logs found. Claude, Codex, Grok not installed.');
  });

  it('handles an empty provider list', () => {
    expect(line('en', [])).toBe('No usage logs have been read yet.');
  });

  it('returns descriptors, not a finished string, so the locale decides word order', () => {
    // The whole point of the descriptor: English puts the provider list first
    // in "Codex not installed", zh-TW puts it last. A concatenated string could
    // not have done this.
    expect(
      line('zh-TW', [
        { provider: 'claude', present: true },
        { provider: 'codex', present: false },
      ]),
    ).toBe('正在讀取 Claude。 未安裝 Codex。');
  });

  it('keeps vendor names out of the translated text, so they never get renamed', () => {
    expect(describeProviders([{ provider: 'grok', present: true, error: 'EACCES' }])).toEqual([
      { text: 'No AI CLI logs found.', params: {} },
      { text: 'Could not read {providers}.', params: { providers: 'Grok' } },
    ]);
  });
});
