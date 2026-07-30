import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Coordinator } from './coordinator.js';

const RUN_REAL_PTY = process.env.RUN_COORDINATOR_PTY_TEST === '1';
const describeRealPty = RUN_REAL_PTY ? describe : describe.skip;
const fakeAgentSource = fileURLToPath(new URL('../../scripts/fake-agent.mjs', import.meta.url));

interface CaptureRecord {
  profile: string;
  payload: string;
  at: number;
}

const mockWin = {
  isDestroyed: () => false,
  webContents: { send: () => undefined },
} as unknown as import('electron').BrowserWindow;

function runGit(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function createRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'parallel-code-real-pty-repo-'));
  runGit(repo, ['init']);
  runGit(repo, ['checkout', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'parallel-code-test@example.com']);
  runGit(repo, ['config', 'user.name', 'Parallel Code Test']);
  writeFileSync(join(repo, 'README.md'), '# test repo\n');
  runGit(repo, ['add', 'README.md']);
  runGit(repo, ['commit', '-m', 'initial']);
  return repo;
}

function createFakeCommand(root: string, profile: string): string {
  const binDir = join(root, '.fake-bin');
  mkdirSync(binDir, { recursive: true });
  const command = join(binDir, `fake-${profile}-agent`);
  copyFileSync(fakeAgentSource, command);
  chmodSync(command, 0o755);
  return command;
}

function readCapture(capturePath: string): CaptureRecord[] {
  if (!existsSync(capturePath)) return [];
  return readFileSync(capturePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CaptureRecord);
}

async function expectPromptDeliveredOnce(params: {
  profile: string;
  extraArgs?: string[];
  promptSuffix?: string;
}): Promise<void> {
  const repo = createRepo();
  const capturePath = join(
    repo,
    '.captures',
    `${params.profile}${params.promptSuffix ?? ''}.jsonl`,
  );
  const command = createFakeCommand(repo, params.profile);
  const coordinator = new Coordinator();
  let taskId: string | undefined;
  const assignment = `Do the ${params.profile}${params.promptSuffix ?? ''} startup assignment.`;

  try {
    coordinator.setWindow(mockWin);
    coordinator.setDefaultProject('proj-1', repo);
    coordinator.registerCoordinator('coord-1', 'proj-1', {
      branchName: 'main',
      worktreePath: repo,
    });
    coordinator.setCoordinatorSpawnDefaults('coord-1', command, [
      '--profile',
      params.profile,
      '--capture',
      capturePath,
      ...(params.extraArgs ?? []),
    ]);

    const task = await coordinator.createTask({
      name: `${params.profile} startup delivery`,
      prompt: assignment,
      coordinatorTaskId: 'coord-1',
    });
    taskId = task.id;

    const records = await waitForCapture(
      capturePath,
      (items) => items.filter((item) => item.payload.includes(assignment)).length === 1,
    );
    const matching = records.filter((item) => item.payload.includes(assignment));

    expect(matching).toHaveLength(1);
    expect(matching[0].profile).toBe(params.profile);
    expect(matching[0].payload).toMatch(/\[SUB-TASK MODE]|<sub-task-mode>/);

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(
      readCapture(capturePath).filter((item) => item.payload.includes(assignment)),
    ).toHaveLength(1);
  } finally {
    if (taskId) {
      await coordinator.closeTask(taskId).catch(() => undefined);
    }
    rmSync(dirname(capturePath), { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
}

async function waitForCapture(
  capturePath: string,
  predicate: (records: CaptureRecord[]) => boolean,
  timeoutMs = 8_000,
): Promise<CaptureRecord[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const records = readCapture(capturePath);
    if (predicate(records)) return records;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return readCapture(capturePath);
}

/**
 * Two sibling sub-tasks under one coordinator, both driven by real PTYs.
 *
 * The target runs with `--newline-submits`, modelling an agent whose line
 * editor treats LF as Enter — precisely the agent wave P said it could not
 * protect. Everything here is measured at the far end of a real pty, not
 * asserted against a mock write.
 */
async function withRelayPair(
  fn: (ctx: {
    coordinator: Coordinator;
    source: { id: string };
    target: { id: string };
    targetCapture: string;
    sourceCapture: string;
  }) => Promise<void>,
): Promise<void> {
  const repo = createRepo();
  const captureDir = join(repo, '.captures');
  const sourceCapture = join(captureDir, 'relay-source.jsonl');
  const targetCapture = join(captureDir, 'relay-target.jsonl');
  const command = createFakeCommand(repo, 'relay');
  const coordinator = new Coordinator();
  const created: string[] = [];

  try {
    coordinator.setWindow(mockWin);
    coordinator.setDefaultProject('proj-1', repo);
    coordinator.registerCoordinator('coord-1', 'proj-1', {
      branchName: 'main',
      worktreePath: repo,
    });

    coordinator.setCoordinatorSpawnDefaults('coord-1', command, [
      '--profile',
      'codex',
      '--capture',
      sourceCapture,
    ]);
    const source = await coordinator.createTask({
      name: 'relay source',
      prompt: 'Produce some multi-line output for the sibling task.',
      coordinatorTaskId: 'coord-1',
    });
    created.push(source.id);

    coordinator.setCoordinatorSpawnDefaults('coord-1', command, [
      '--profile',
      'codex',
      '--capture',
      targetCapture,
      // No bracketed paste advertised, and LF submits. The worst case.
      '--newline-submits',
    ]);
    const target = await coordinator.createTask({
      name: 'relay target',
      prompt: 'Wait for the coordinator.',
      coordinatorTaskId: 'coord-1',
    });
    created.push(target.id);

    // Wait for each assignment to actually land, matched by its own text — a
    // bare "at least one record" check races with the second delivery and makes
    // the later "exactly one relay submission" count unreliable.
    await waitForCapture(sourceCapture, (items) =>
      items.some((i) => i.payload.includes('Produce some multi-line output')),
    );
    await waitForCapture(targetCapture, (items) =>
      items.some((i) => i.payload.includes('Wait for the coordinator')),
    );

    await fn({ coordinator, source, target, targetCapture, sourceCapture });
  } finally {
    for (const id of created) {
      await coordinator.closeTask(id).catch(() => undefined);
    }
    rmSync(captureDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
}

describeRealPty('Coordinator real PTY relay delivery', () => {
  it('delivers a multi-line relay body as exactly one submission on an LF-submits agent', async () => {
    await withRelayPair(async ({ coordinator, source, target, targetCapture }) => {
      // The source's scrollback is genuinely multi-line by now: banner, prompt
      // marker, "working...", and the echo of its own assignment.
      expect(coordinator.getTaskOutput(source.id)).toContain('\n');

      const before = readCapture(targetCapture).length;
      // Whether this writes straight through or lands in the pending-prompt
      // FIFO is timing, not the property under test — either way it must reach
      // the PTY as one submission, so the assertion is on what arrives.
      await coordinator.relayToTask({
        fromTaskId: source.id,
        toTaskId: target.id,
        source: 'output',
        note: 'this is what the sibling has been doing',
      });

      const records = await waitForCapture(
        targetCapture,
        (items) =>
          items.length > before &&
          items.slice(before).some((i) => i.payload.includes('RELAY_BODY_JSON=')),
      );
      const delivered = records.slice(before);

      // One submission. Not one per line of the relayed body.
      expect(delivered).toHaveLength(1);

      const payload = delivered[0].payload;
      // Every fragment is under the one provenance header, because there is
      // only one fragment.
      expect(payload).toContain('Relayed by the coordinator agent through relay_to_task');
      expect(payload).toContain('this is what the sibling has been doing');
      expect(payload).not.toContain('\n');

      // The multi-line source content survives, escaped and recoverable.
      const body = JSON.parse(payload.slice(payload.indexOf('RELAY_BODY_JSON=') + 16)) as string;
      expect(body).toContain('\n');
    });
  }, 30_000);

  it('shows the hazard is real: a multi-line send_prompt splits on the same agent', async () => {
    await withRelayPair(async ({ coordinator, target, targetCapture }) => {
      // The control case. `send_prompt` preserves `\n` by design (wave P's D3,
      // because SUB_TASK_PREAMBLE is multi-line), so on this agent a multi-line
      // prompt arrives as several submissions and only the first carries the
      // provenance header. That is the outcome relay_to_task has to avoid, and
      // it is measured here rather than assumed.
      const before = readCapture(targetCapture).length;
      await coordinator.sendPrompt(target.id, 'first fragment\nsecond fragment\nthird fragment');

      const records = await waitForCapture(
        targetCapture,
        (items) => items.slice(before).length >= 3,
      );
      const delivered = records.slice(before);

      expect(delivered.length).toBeGreaterThan(1);
      const unmarked = delivered.filter(
        (item) => !item.payload.includes('[parallel-code]') && item.payload.trim(),
      );
      expect(unmarked.length).toBeGreaterThan(0);
      expect(unmarked.some((item) => item.payload.includes('second fragment'))).toBe(true);
    });
  }, 30_000);
});

describeRealPty('Coordinator real PTY initial prompt delivery', () => {
  it.each(['codex', 'claude', 'gemini', 'copilot'])(
    'sends a new coordinated task assignment to a fake %s agent exactly once',
    async (profile) => {
      await expectPromptDeliveredOnce({ profile });
    },
    15_000,
  );

  it.each(['codex', 'claude', 'gemini', 'copilot'])(
    'sends to fake %s exactly once when startup redraw evicts the prompt marker',
    async (profile) => {
      await expectPromptDeliveredOnce({
        profile,
        extraArgs: ['--transient-ready'],
        promptSuffix: '-transient',
      });
    },
    15_000,
  );

  it('waits long enough for a fake Claude paste to settle before submitting', async () => {
    await expectPromptDeliveredOnce({
      profile: 'claude',
      extraArgs: ['--bracketed-paste', '--min-enter-delay-ms', '200'],
      promptSuffix: '-settled-paste',
    });
  }, 15_000);
});
