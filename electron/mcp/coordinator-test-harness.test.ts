import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setupCoordinatorHarness,
  mockExistsSync,
  mockCreateBackendTask,
  mockWin,
} from './coordinator-test-harness.js';

const { Coordinator } = await setupCoordinatorHarness();

/**
 * Guards the harness's own teardown.
 *
 * createTask arms a real 1.5s initial-prompt timer, and tryDeliverInitialPrompt
 * re-arms it every 1.5s until the agent reports a ready prompt — so a test that
 * creates a task and never closes it leaves a self-perpetuating real timer
 * running past its own end. Under full-suite load a file's wall clock stretches
 * past 1.5s and such a timer fires *inside a later test*, driving writeToAgent
 * and notifyRenderer for a stale agent against the file-global mocks that later
 * test is asserting on. That is what made
 * "deleteTask failure clears scheduled initial prompt delivery timers" flaky.
 *
 * The harness disarms these timers in an afterEach. This asserts it actually
 * does, by looking at the previous test's coordinator from the next test — no
 * sleeps and no wall-clock dependency, so the guard cannot itself go flaky.
 */
type PromptTimerView = {
  initialPromptTimers: Map<string, unknown>;
  queuedPromptFlushTimers: Map<string, unknown>;
};

describe('coordinator test harness — timers do not outlive their test', () => {
  let coordinator: InstanceType<typeof Coordinator>;
  let previous: PromptTimerView | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockCreateBackendTask.mockResolvedValue({
      id: 'task-1',
      branch_name: 'task/test',
      worktree_path: '/tmp/test',
    });
    coordinator = new Coordinator();
    coordinator.setWindow(mockWin);
    coordinator.setDefaultProject('proj-1', '/tmp/project');
    coordinator.registerCoordinator('coord-1', 'proj-1');
  });

  it('createTask arms an initial-prompt timer that the test never closes', async () => {
    await coordinator.createTask({ name: 'leaky', prompt: 'do', coordinatorTaskId: 'coord-1' });
    previous = coordinator as unknown as PromptTimerView;
    expect(previous.initialPromptTimers.has('task-1')).toBe(true);
  });

  it('the previous test left no armed prompt timers behind', () => {
    expect(previous).toBeDefined();
    expect(previous?.initialPromptTimers.size).toBe(0);
    expect(previous?.queuedPromptFlushTimers.size).toBe(0);
  });
});
