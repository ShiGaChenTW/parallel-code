import { describe, expect, it } from 'vitest';
import { BUDGETS, checkBudgets, formatReport } from './check-bundle-size.mjs';

describe('check-bundle-size', () => {
  it('passes when every measurement is within budget', () => {
    const result = checkBudgets({ a: 100, b: 200 }, { a: 100, b: 500 });
    expect(result.ok).toBe(true);
    expect(result.checks.map((c) => c.ok)).toEqual([true, true]);
  });

  it('treats a measurement exactly at budget as passing', () => {
    expect(checkBudgets({ a: 500 }, { a: 500 }).ok).toBe(true);
  });

  it('fails when a measurement exceeds its budget by a single byte', () => {
    const result = checkBudgets({ a: 501 }, { a: 500 });
    expect(result.ok).toBe(false);
    expect(result.checks[0]).toMatchObject({ name: 'a', actual: 501, budget: 500, ok: false });
  });

  it('fails when a budgeted measurement is missing rather than silently passing', () => {
    const result = checkBudgets({}, { a: 500 });
    expect(result.ok).toBe(false);
    expect(result.checks[0].reason).toBe('not measured');
  });

  it('reports measurements that have no budget without failing', () => {
    const result = checkBudgets({ a: 1, extra: 2 }, { a: 500 });
    expect(result.ok).toBe(true);
    expect(result.unbudgeted).toEqual(['extra']);
  });

  it('names the overage in the report so CI output is actionable', () => {
    const report = formatReport(checkBudgets({ a: 1_200 }, { a: 1_000 }));
    expect(report).toContain('FAIL');
    expect(report).toContain('over by 200 B');
    expect(report).toContain('scripts/check-bundle-size.mjs');
  });

  it('keeps budgets above the sizes measured when the gate was introduced', () => {
    // Guards against someone "fixing" a failure by lowering a budget below the
    // known-good baseline, which would make the gate unfailable-but-meaningless.
    expect(BUDGETS['renderer entry chunk']).toBeGreaterThanOrEqual(1_266_514);
    expect(BUDGETS['dist total']).toBeGreaterThanOrEqual(15_262_119);
  });

  it('keeps the entry budget tight enough to catch a monaco-scale regression', () => {
    // Measured, not guessed: re-adding the monaco import produced a 5,004,337 B
    // entry chunk. A budget that would still pass at that size is not a gate.
    expect(BUDGETS['renderer entry chunk']).toBeLessThan(5_004_337);
  });
});
