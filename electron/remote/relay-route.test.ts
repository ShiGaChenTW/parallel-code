// REST-boundary tests for POST /api/tasks/:toTaskId/relay.
//
// Why this file exists at all: the MCP server is a separate Node process that
// reaches the Electron app over HTTP, and every coordinator route forwards body
// fields by hand. C1 (`cdb75dd`) established the failure mode the hard way — a
// body field nobody reads disappears silently while compile, typecheck, lint and
// the whole unit suite stay green. The only thing that catches it is a test that
// pushes the field across the real socket and asserts it arrived. That is what
// the first describe block below does.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import type { Coordinator } from '../mcp/coordinator.js';
import type { ApiTaskDetail } from '../mcp/types.js';

vi.mock('../ipc/pty.js', () => ({
  writeToAgent: vi.fn(),
  resizeAgent: vi.fn(),
  killAgent: vi.fn(),
  subscribeToAgent: vi.fn(),
  unsubscribeFromAgent: vi.fn(),
  getAgentScrollback: vi.fn(() => null),
  getActiveAgentIds: vi.fn(() => []),
  getAgentMeta: vi.fn(() => null),
  getAgentCols: vi.fn(() => 80),
  onPtyEvent: vi.fn(() => vi.fn()),
}));

vi.mock('./protocol.js', () => ({
  parseClientMessage: vi.fn(() => null),
}));

const { startRemoteServer } = await import('./server.js');

const COORD_A = 'coordinator-a';
const COORD_B = 'coordinator-b';

function task(id: string, coordinatorTaskId: string): ApiTaskDetail {
  return {
    id,
    name: `Task ${id}`,
    branchName: `task/${id}`,
    worktreePath: `/tmp/${id}`,
    projectId: 'proj-1',
    agentId: `agent-${id}`,
    status: 'idle',
    coordinatorTaskId,
    exitCode: null,
  };
}

/** Two siblings under coordinator A, and one task belonging to coordinator B. */
const siblingOne = task('a-one', COORD_A);
const siblingTwo = task('a-two', COORD_A);
const foreign = task('b-one', COORD_B);

let relayToTask: ReturnType<typeof vi.fn>;

function makeMockCoordinator(): Coordinator {
  const tasks = new Map<string, ApiTaskDetail>([
    [siblingOne.id, siblingOne],
    [siblingTwo.id, siblingTwo],
    [foreign.id, foreign],
  ]);
  relayToTask = vi
    .fn()
    .mockResolvedValue({ queued: false, truncated: true, sourceBytes: 4242, deliveredBytes: 900 });

  return {
    isRegisteredCoordinator: (id: string) => id === COORD_A || id === COORD_B,
    listTasks: () => [],
    getTaskStatus: (id: string) => tasks.get(id) ?? null,
    getTaskDoneToken: () => null,
    relayToTask,
  } as unknown as Coordinator;
}

let serverToken = '';
let subtaskToken = '';
let serverPort = 0;
let serverStop: () => Promise<void>;

async function startServer(): Promise<void> {
  // One coordinator instance for the whole test, not one per request — the
  // assertions read the spy after the response comes back.
  const coordinator = makeMockCoordinator();
  const srv = await startRemoteServer({
    port: 0,
    host: '0.0.0.0',
    staticDir: '/nonexistent',
    getTaskName: (id) => id,
    getAgentStatus: () => ({ status: 'exited', exitCode: null, lastLine: '' }),
    getCoordinator: () => coordinator,
  });
  serverToken = srv.token;
  subtaskToken = srv.subtaskToken;
  serverPort = srv.port;
  serverStop = srv.stop;
}

function request(
  method: string,
  path: string,
  body: unknown,
  opts: { token: string; coordinatorId?: string },
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    };
    if (opts.coordinatorId) headers['X-Coordinator-Id'] = opts.coordinatorId;
    if (bodyStr) headers['Content-Length'] = String(Buffer.byteLength(bodyStr));

    const req = http.request(
      { hostname: '127.0.0.1', port: serverPort, path, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            parsed = { raw };
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const relay = (toTaskId: string, body: unknown, coordinatorId = COORD_A) =>
  request('POST', `/api/tasks/${toTaskId}/relay`, body, { token: serverToken, coordinatorId });

beforeEach(startServer);
afterEach(async () => {
  await serverStop();
});

describe('POST /api/tasks/:id/relay — every field survives the process boundary', () => {
  it('forwards fromTaskId, toTaskId, source and note to the coordinator', async () => {
    const res = await relay(siblingTwo.id, {
      fromTaskId: siblingOne.id,
      source: 'diff',
      note: 'here is what the other task changed',
    });

    expect(res.status).toBe(200);
    // The C1 guard: a hand-forwarded field that nobody reads on this side would
    // vanish here and nowhere else.
    expect(relayToTask).toHaveBeenCalledWith({
      fromTaskId: siblingOne.id,
      toTaskId: siblingTwo.id,
      source: 'diff',
      note: 'here is what the other task changed',
    });
  });

  it('relays without a note when the coordinator did not write one', async () => {
    await relay(siblingTwo.id, { fromTaskId: siblingOne.id, source: 'output' });

    expect(relayToTask).toHaveBeenCalledWith({
      fromTaskId: siblingOne.id,
      toTaskId: siblingTwo.id,
      source: 'output',
      note: undefined,
    });
  });

  it('returns the queue and truncation result so the tool can report it', async () => {
    const res = await relay(siblingTwo.id, { fromTaskId: siblingOne.id, source: 'output' });

    expect(res.body).toMatchObject({
      ok: true,
      queued: false,
      truncated: true,
      sourceBytes: 4242,
    });
  });

  it('strips control characters out of the note at admission', async () => {
    await relay(siblingTwo.id, {
      fromTaskId: siblingOne.id,
      source: 'output',
      note: 'look\x00at\x1bthis',
    });

    const note = relayToTask.mock.calls[0][0].note as string;
    expect(note).not.toContain('\x00');
    expect(note).not.toContain('\x1b');
  });
});

describe('POST /api/tasks/:id/relay — ownership graph', () => {
  it('rejects a target owned by another coordinator', async () => {
    const res = await relay(foreign.id, { fromTaskId: siblingOne.id, source: 'output' });

    expect(res.status).toBe(403);
    expect(relayToTask).not.toHaveBeenCalled();
  });

  it('rejects a source owned by another coordinator', async () => {
    // The dangerous direction: the target is legitimately owned, so a check on
    // the path task ID alone would pass and hand back another coordinator's
    // terminal contents.
    const res = await relay(siblingTwo.id, { fromTaskId: foreign.id, source: 'output' });

    expect(res.status).toBe(403);
    expect(relayToTask).not.toHaveBeenCalled();
  });

  it('rejects an unknown source task', async () => {
    const res = await relay(siblingTwo.id, { fromTaskId: 'does-not-exist', source: 'output' });

    expect(res.status).toBe(404);
    expect(relayToTask).not.toHaveBeenCalled();
  });

  it('rejects an unknown target task', async () => {
    const res = await relay('does-not-exist', { fromTaskId: siblingOne.id, source: 'output' });

    expect(res.status).toBe(404);
    expect(relayToTask).not.toHaveBeenCalled();
  });

  it('refuses a coordinator token with no X-Coordinator-Id header', async () => {
    const res = await request(
      'POST',
      `/api/tasks/${siblingTwo.id}/relay`,
      { fromTaskId: siblingOne.id, source: 'output' },
      { token: serverToken },
    );

    expect(res.status).toBe(403);
    expect(relayToTask).not.toHaveBeenCalled();
  });
});

describe('POST /api/tasks/:id/relay — sub-task tokens', () => {
  it('is not reachable with a sub-task token', async () => {
    // Third enforcement layer, after SUBTASK_TOOLS and handleMCPToolCall: the
    // REST surface for a sub-task token is done/land and nothing else.
    const res = await request(
      'POST',
      `/api/tasks/${siblingTwo.id}/relay`,
      { fromTaskId: siblingOne.id, source: 'output' },
      { token: subtaskToken },
    );

    expect(res.status).toBe(403);
    expect(relayToTask).not.toHaveBeenCalled();
  });
});

describe('POST /api/tasks/:id/relay — input validation', () => {
  it('rejects a missing fromTaskId', async () => {
    const res = await relay(siblingTwo.id, { source: 'output' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('fromTaskId');
    expect(relayToTask).not.toHaveBeenCalled();
  });

  it('rejects a blank fromTaskId', async () => {
    const res = await relay(siblingTwo.id, { fromTaskId: '   ', source: 'output' });

    expect(res.status).toBe(400);
    expect(relayToTask).not.toHaveBeenCalled();
  });

  it('rejects an unknown source kind', async () => {
    const res = await relay(siblingTwo.id, { fromTaskId: siblingOne.id, source: 'scrollback' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('source must be one of');
    expect(relayToTask).not.toHaveBeenCalled();
  });

  it('rejects a non-string note', async () => {
    const res = await relay(siblingTwo.id, {
      fromTaskId: siblingOne.id,
      source: 'output',
      note: 42,
    });

    expect(res.status).toBe(400);
    expect(relayToTask).not.toHaveBeenCalled();
  });
});
