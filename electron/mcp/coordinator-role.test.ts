import { describe, it, expect, beforeEach } from 'vitest';
import {
  setupCoordinatorHarness,
  resetCoordinatorMocks,
  mockNextTask,
  registerDefaultCoordinator,
  mockCreateBackendTask,
} from './coordinator-test-harness.js';
import { SUB_TASK_PREAMBLE, buildRolePreamble } from './sub-task-preamble.js';

const { Coordinator } = await setupCoordinatorHarness();

const ESC = '\x1b';

describe('Coordinator createTask — sub-task role', () => {
  let coordinator: InstanceType<typeof Coordinator>;

  beforeEach(() => {
    resetCoordinatorMocks();
    mockNextTask();
    coordinator = registerDefaultCoordinator(new Coordinator());
    coordinator.registerCoordinator('coord-1', 'proj-1');
  });

  // The regression that matters: everything that exists today was created
  // without a role, and must be delivered exactly as it is today.
  it('composes the initial prompt exactly as before when no role is supplied', async () => {
    await coordinator.createTask({
      name: 'test',
      prompt: 'implement the parser',
      coordinatorTaskId: 'coord-1',
    });

    expect(coordinator.getTask('task-1')?.initialPrompt).toBe(
      `${SUB_TASK_PREAMBLE}implement the parser`,
    );
  });

  it('does not mention a role anywhere in the prompt when no role is supplied', async () => {
    await coordinator.createTask({
      name: 'test',
      prompt: 'implement the parser',
      coordinatorTaskId: 'coord-1',
    });

    expect(coordinator.getTask('task-1')?.initialPrompt).not.toContain('[ROLE]');
  });

  it('prepends the role block ahead of the sub-task preamble', async () => {
    await coordinator.createTask({
      name: 'test',
      prompt: 'review the diff',
      coordinatorTaskId: 'coord-1',
      role: 'Reviewer — read-only, do not edit files',
    });

    expect(coordinator.getTask('task-1')?.initialPrompt).toBe(
      `${buildRolePreamble('Reviewer — read-only, do not edit files')}${SUB_TASK_PREAMBLE}review the diff`,
    );
  });

  it('carries roleInstructions into the same block', async () => {
    await coordinator.createTask({
      name: 'test',
      prompt: 'review the diff',
      coordinatorTaskId: 'coord-1',
      role: 'Reviewer',
      roleInstructions: 'Report findings in the terminal. Never run git commit.',
    });

    const prompt = coordinator.getTask('task-1')?.initialPrompt ?? '';
    expect(prompt).toContain('[ROLE] Reviewer');
    expect(prompt).toContain('Report findings in the terminal. Never run git commit.');
    expect(prompt.indexOf('[ROLE]')).toBeLessThan(prompt.indexOf('[SUB-TASK MODE]'));
    expect(prompt.endsWith('review the diff')).toBe(true);
  });

  it('takes any free-text role — no enum is enforced', async () => {
    await coordinator.createTask({
      name: 'test',
      prompt: 'do the thing',
      coordinatorTaskId: 'coord-1',
      role: 'Release-notes archaeologist (1.9.x only)',
    });

    expect(coordinator.getTask('task-1')?.initialPrompt).toContain(
      '[ROLE] Release-notes archaeologist (1.9.x only)',
    );
  });

  it('sanitises the role the same way it sanitises the prompt body', async () => {
    await coordinator.createTask({
      name: 'test',
      prompt: 'do the thing',
      coordinatorTaskId: 'coord-1',
      role: `Rev${ESC}[31miewer\r`,
      roleInstructions: `read${ESC}[201~ only\r\nplease`,
    });

    const prompt = coordinator.getTask('task-1')?.initialPrompt ?? '';
    expect(prompt).toContain('[ROLE] Reviewer');
    expect(prompt).toContain('read only\nplease');
    expect(prompt).not.toContain(ESC);
    expect(prompt).not.toContain('\r');
    expect(prompt).not.toContain('201~');
  });

  it('treats a role that sanitises away as no role at all', async () => {
    await coordinator.createTask({
      name: 'test',
      prompt: 'implement the parser',
      coordinatorTaskId: 'coord-1',
      role: `${ESC}[31m\r`,
      roleInstructions: '\x00\x07',
    });

    expect(coordinator.getTask('task-1')?.initialPrompt).toBe(
      `${SUB_TASK_PREAMBLE}implement the parser`,
    );
  });

  it('leaves initialPrompt undefined when a role is supplied without a prompt', async () => {
    await coordinator.createTask({
      name: 'test',
      coordinatorTaskId: 'coord-1',
      role: 'Reviewer',
    });

    expect(coordinator.getTask('task-1')?.initialPrompt).toBeUndefined();
  });

  it('counts the role block against the prompt byte limit, before creating a worktree', async () => {
    mockCreateBackendTask.mockClear();

    await expect(
      coordinator.createTask({
        name: 'test',
        prompt: 'x'.repeat(64 * 1024 - SUB_TASK_PREAMBLE.length - 100),
        coordinatorTaskId: 'coord-1',
        roleInstructions: 'y'.repeat(500),
      }),
    ).rejects.toThrow('byte limit');

    expect(mockCreateBackendTask).not.toHaveBeenCalled();
  });
});
