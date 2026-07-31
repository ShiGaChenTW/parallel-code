import { describe, expect, it } from 'vitest';

import {
  describeProviders,
  formatShare,
  formatTokens,
  PROVIDER_COLORS,
  shortenPath,
  sumTokenTotals,
  TOKEN_PROVIDERS,
  visibleProviderColumns,
  worktreeUsage,
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

describe('worktreeUsage', () => {
  const row = (path: string, byProvider: TokenUsagePathRow['byProvider']): TokenUsagePathRow => ({
    path,
    totals: Object.values(byProvider).reduce(
      (acc, totals) => ({
        input: acc.input + (totals?.input ?? 0),
        output: acc.output + (totals?.output ?? 0),
        cacheRead: acc.cacheRead + (totals?.cacheRead ?? 0),
        cacheWrite: acc.cacheWrite + (totals?.cacheWrite ?? 0),
      }),
      t(0),
    ),
    byProvider,
  });

  it('reports no worktree when the task has no path yet', () => {
    const usage = worktreeUsage([row('/repo/wt-a', { claude: t(10) })], undefined);
    expect(usage.state).toBe('no-worktree');
    expect(usage.total).toBe(0);
    expect(usage.shares).toEqual([]);
  });

  it('treats an empty path the same as no path', () => {
    expect(worktreeUsage([row('/repo/wt-a', { claude: t(10) })], '').state).toBe('no-worktree');
  });

  // A brand-new task: the worktree exists, no agent has run in it yet.
  it('separates "nothing recorded" from "no worktree"', () => {
    const usage = worktreeUsage([row('/repo/wt-a', { claude: t(10) })], '/repo/wt-b');
    expect(usage.state).toBe('no-usage');
    expect(usage.total).toBe(0);
    expect(usage.shares).toEqual([]);
  });

  it('reports no usage for a matched row whose counters are all zero', () => {
    const usage = worktreeUsage([row('/repo/wt-a', { claude: t(0) })], '/repo/wt-a');
    expect(usage.state).toBe('no-usage');
    expect(usage.shares).toEqual([]);
  });

  // The reason this matches exactly rather than by prefix: these two paths are
  // the ordinary shape of two branches off one repo.
  it('does not fold a sibling worktree into a prefix of its path', () => {
    const rows = [
      row('/repo/.worktrees/feature', { claude: t(100) }),
      row('/repo/.worktrees/feature-2', { claude: t(7) }),
    ];
    expect(worktreeUsage(rows, '/repo/.worktrees/feature').total).toBe(100);
    expect(worktreeUsage(rows, '/repo/.worktrees/feature-2').total).toBe(7);
  });

  it('counts only the requested worktree, never the whole snapshot', () => {
    const rows = [row('/repo/wt-a', { claude: t(100) }), row('/repo/wt-b', { claude: t(900) })];
    expect(worktreeUsage(rows, '/repo/wt-a').total).toBe(100);
  });

  it('sums all four counters into the total', () => {
    const usage = worktreeUsage([row('/repo/wt-a', { claude: t(1, 2, 3, 4) })], '/repo/wt-a');
    expect(usage.total).toBe(10);
    expect(usage.totals).toEqual({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 });
  });

  it('orders shares biggest first and drops providers that spent nothing', () => {
    const usage = worktreeUsage(
      [row('/repo/wt-a', { claude: t(10), codex: t(0), grok: t(30) })],
      '/repo/wt-a',
    );
    expect(usage.shares.map((s) => s.provider)).toEqual(['grok', 'claude']);
    expect(usage.shares.map((s) => s.share)).toEqual([0.75, 0.25]);
  });

  // Edge case the stacked bar has to survive: one provider must fill the bar,
  // not render a stub that looks like a broken chart.
  it('gives a lone provider the whole bar', () => {
    const usage = worktreeUsage([row('/repo/wt-a', { codex: t(42) })], '/repo/wt-a');
    expect(usage.state).toBe('ok');
    expect(usage.shares).toHaveLength(1);
    expect(usage.shares[0].share).toBe(1);
    expect(usage.shares[0].label).toBe('Codex');
  });

  it('always fills the bar exactly, even when totals disagree with the providers', () => {
    // Defensive: a snapshot where `totals` outruns `byProvider` would otherwise
    // draw a bar with a gap in it, which reads as a rendering fault.
    const usage = worktreeUsage(
      [{ path: '/repo/wt-a', totals: t(1000), byProvider: { claude: t(10), grok: t(30) } }],
      '/repo/wt-a',
    );
    expect(usage.shares.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 10);
    expect(usage.total).toBe(1000);
  });

  it('gives every provider a distinct colour', () => {
    const colors = TOKEN_PROVIDERS.map((provider) => PROVIDER_COLORS[provider]);
    expect(new Set(colors).size).toBe(TOKEN_PROVIDERS.length);
  });
});

describe('formatShare', () => {
  it.each([
    [1, '100%'],
    [0.75, '75%'],
    [0.4321, '43%'],
    // The rounding boundary: half a percent still rounds up to a real number,
    // below it the label would round to a misleading 0%.
    [0.005, '1%'],
    [0.004, '<1%'],
    [0.0001, '<1%'],
    [0, '0%'],
  ])('formats %d as %s', (share, expected) => {
    expect(formatShare(share)).toBe(expected);
  });

  it('never writes 0% for a provider that is visibly in the bar', () => {
    expect(formatShare(1 / 100_000)).toBe('<1%');
  });

  it('treats nonsense as zero', () => {
    expect(formatShare(NaN)).toBe('0%');
    expect(formatShare(-1)).toBe('0%');
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
