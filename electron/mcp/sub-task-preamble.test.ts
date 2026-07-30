import { describe, expect, it } from 'vitest';
import { SUB_TASK_PREAMBLE, buildRolePreamble } from './sub-task-preamble.js';

describe('buildRolePreamble', () => {
  it('returns an empty string when neither field is supplied', () => {
    expect(buildRolePreamble()).toBe('');
    expect(buildRolePreamble(undefined, undefined)).toBe('');
  });

  it('returns an empty string for blank fields', () => {
    expect(buildRolePreamble('', '')).toBe('');
    expect(buildRolePreamble('   ', '\n\t ')).toBe('');
  });

  it('keeps the role verbatim — it is free text, not an enum', () => {
    const role = 'Reviewer — read-only, do not edit files';
    expect(buildRolePreamble(role)).toContain(`[ROLE] ${role}`);
  });

  it('accepts a role no enum would have predicted', () => {
    expect(buildRolePreamble('Release-notes archaeologist (1.9.x only)')).toContain(
      '[ROLE] Release-notes archaeologist (1.9.x only)',
    );
  });

  it('includes the role instructions when supplied', () => {
    const block = buildRolePreamble('Reviewer', 'Report findings; never run git commit.');
    expect(block).toContain('[ROLE] Reviewer');
    expect(block).toContain('Report findings; never run git commit.');
  });

  it('still produces a block when only instructions are supplied', () => {
    const block = buildRolePreamble(undefined, 'Read the diff and report risks.');
    expect(block).not.toBe('');
    expect(block).toContain('Read the diff and report risks.');
  });

  it('trims surrounding whitespace off both fields', () => {
    expect(buildRolePreamble('  Planner  ', '  plan only  ')).toContain('[ROLE] Planner');
    expect(buildRolePreamble('  Planner  ', '  plan only  ')).toContain('plan only\n');
  });

  it('tells the sub-agent to raise a conflict rather than silently ignore the role', () => {
    expect(buildRolePreamble('Reviewer')).toMatch(/say so/i);
  });

  it('ends with a separator so it reads as a block ahead of the sub-task preamble', () => {
    const composed = buildRolePreamble('Reviewer') + SUB_TASK_PREAMBLE;
    expect(composed).toMatch(/---\n\n\[SUB-TASK MODE\]/);
    expect(composed.startsWith('[ROLE] Reviewer')).toBe(true);
  });
});
