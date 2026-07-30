import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSpawn } = vi.hoisted(() => ({
  // Typed with its real parameters so assertions can read the spawned command
  // back off `mock.calls` rather than inspecting an untyped empty tuple.
  mockSpawn: vi.fn((_command: string, _args: string[], _options?: unknown) => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  })),
}));

vi.mock('child_process', () => ({ spawn: mockSpawn }));

// `ask-code` imports `validateCommand` from pty.ts, which pulls in node-pty.
// Stubbing the module keeps this suite about the switch rather than about
// whether a native addon loads.
vi.mock('./pty.js', () => ({ validateCommand: vi.fn() }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { askAboutCode } = await import('./ask-code.js');
const { setMinimaxApiKey } = await import('./ask-code-minimax.js');
const { setOfflineMode } = await import('./offline.js');

function makeMockWin() {
  const messages: { type?: string; text?: string; exitCode?: number }[] = [];
  const win = {
    isDestroyed: () => false,
    webContents: {
      send: (_channel: string, msg: unknown) => {
        messages.push(msg as { type?: string });
      },
    },
  } as unknown as import('electron').BrowserWindow;
  return { win, messages };
}

beforeEach(() => {
  // Module-level gate: set explicitly so each test stands alone.
  setOfflineMode(false);
  mockSpawn.mockClear();
  mockFetch.mockClear();
  setMinimaxApiKey('test-key');
});

afterEach(() => setOfflineMode(false));

describe('Ask About Code (Claude CLI) with offline mode on', () => {
  it('never spawns the claude CLI', () => {
    setOfflineMode(true);
    const { win } = makeMockWin();
    askAboutCode(win, { requestId: 'r1', channelId: 'c1', prompt: 'what?', cwd: '/repo' });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('answers in the panel rather than leaving it spinning', () => {
    setOfflineMode(true);
    const { win, messages } = makeMockWin();
    askAboutCode(win, { requestId: 'r1', channelId: 'c1', prompt: 'what?', cwd: '/repo' });

    const error = messages.find((m) => m.type === 'error');
    expect(error?.text).toContain('Offline mode is on');
    expect(error?.text).toContain('Turn it off in Settings');
    // The `done` is what stops the spinner — without it the panel hangs, which
    // is precisely the failure mode this feature exists to avoid.
    expect(messages.some((m) => m.type === 'done')).toBe(true);
  });
});

describe('Ask About Code (MiniMax) with offline mode on', () => {
  it('never calls the MiniMax API', () => {
    setOfflineMode(true);
    const { win } = makeMockWin();
    askAboutCode(win, {
      requestId: 'r2',
      channelId: 'c2',
      prompt: 'what?',
      cwd: '/repo',
      provider: 'minimax',
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('names MiniMax in the message, so the reason matches the provider in use', () => {
    setOfflineMode(true);
    const { win, messages } = makeMockWin();
    askAboutCode(win, {
      requestId: 'r2',
      channelId: 'c2',
      prompt: 'what?',
      cwd: '/repo',
      provider: 'minimax',
    });
    expect(messages.find((m) => m.type === 'error')?.text).toContain('MiniMax');
  });
});

describe('with offline mode off', () => {
  it('spawns the claude CLI as before', () => {
    const { win } = makeMockWin();
    askAboutCode(win, { requestId: 'r3', channelId: 'c3', prompt: 'what?', cwd: '/repo' });
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn.mock.calls[0][0]).toBe('claude');
  });
});
