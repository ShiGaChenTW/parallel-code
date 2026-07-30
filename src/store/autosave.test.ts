import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { store, setStore } from './core';
import { persistedSnapshot } from './autosave';
import type { Task } from './types';

describe('autosave snapshot includes new-task-default fields', () => {
  it('defaultStepsEnabled changes the snapshot', () => {
    setStore('defaultStepsEnabled', false);
    const before = persistedSnapshot();
    setStore('defaultStepsEnabled', true);
    const after = persistedSnapshot();
    expect(before).not.toBe(after);
    setStore('defaultStepsEnabled', false);
  });

  it('defaultSkipPermissions changes the snapshot', () => {
    setStore('defaultSkipPermissions', false);
    const before = persistedSnapshot();
    setStore('defaultSkipPermissions', true);
    const after = persistedSnapshot();
    expect(before).not.toBe(after);
    setStore('defaultSkipPermissions', false);
  });

  it('defaultPropagateSkipPermissions changes the snapshot', () => {
    setStore('defaultPropagateSkipPermissions', false);
    const before = persistedSnapshot();
    setStore('defaultPropagateSkipPermissions', true);
    const after = persistedSnapshot();
    expect(before).not.toBe(after);
    setStore('defaultPropagateSkipPermissions', false);
  });

  it('showSteps is not tracked separately (migrated to defaultStepsEnabled)', () => {
    expect('showSteps' in store).toBe(false);
  });
});

/**
 * Handoff (`.claude/handoff.md`) was added as a sibling of `notes`, never as a
 * change to it. These pin both halves of that promise: `notes` still serialises
 * as the plain string GET/PUT /api/mobile/notes/:taskId hands to existing
 * mobile clients, and `handoffContent` stays out of persistence entirely
 * because the worktree file is its only source of truth.
 */
describe('handoff content does not disturb persisted notes', () => {
  const TASK_ID = 'handoff-autosave-task';
  const NOTES = 'human-written notes';
  const HANDOFF = '# Handoff\n\nPick up at session.ts.';

  function persistedTask(): Record<string, unknown> {
    const snapshot = JSON.parse(persistedSnapshot()) as {
      tasks: Record<string, Record<string, unknown>>;
    };
    return snapshot.tasks[TASK_ID];
  }

  beforeEach(() => {
    setStore('tasks', TASK_ID, {
      id: TASK_ID,
      name: 'handoff autosave',
      notes: NOTES,
      lastPrompt: '',
      branchName: 'feat/handoff',
      worktreePath: '/tmp/handoff-autosave-task',
      agentIds: [],
      shellAgentIds: [],
      gitIsolation: 'worktree',
    } as unknown as Task);
    setStore('taskOrder', (order) => [...order, TASK_ID]);
  });

  afterEach(() => {
    setStore('taskOrder', (order) => order.filter((id) => id !== TASK_ID));
    setStore('tasks', TASK_ID, undefined as unknown as Task);
  });

  it('persists notes as a plain string', () => {
    expect(persistedTask().notes).toBe(NOTES);
    expect(typeof persistedTask().notes).toBe('string');
  });

  it('leaves notes untouched once a handoff arrives', () => {
    setStore('tasks', TASK_ID, 'handoffContent', HANDOFF);
    expect(persistedTask().notes).toBe(NOTES);
    expect(typeof persistedTask().notes).toBe('string');
  });

  it('never writes handoffContent into the persisted task', () => {
    setStore('tasks', TASK_ID, 'handoffContent', HANDOFF);
    expect('handoffContent' in persistedTask()).toBe(false);
  });
});
