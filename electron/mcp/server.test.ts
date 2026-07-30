import { describe, expect, it, vi } from 'vitest';
import { handleMCPToolCall } from './server.js';
import type { MCPClient } from './client.js';

function makeClient(): MCPClient {
  return {
    createTask: vi.fn().mockResolvedValue({
      id: 'task-1',
      name: 'child',
      branchName: 'task/child',
      worktreePath: '/tmp/child',
      projectId: 'proj-1',
      agentId: 'agent-1',
      status: 'running',
      coordinatorTaskId: 'coord-1',
      exitCode: null,
    }),
    sendPrompt: vi.fn().mockResolvedValue({ queued: false }),
    relayToTask: vi.fn().mockResolvedValue({ queued: false, truncated: false }),
  } as unknown as MCPClient;
}

describe('MCP server tool handling', () => {
  it('rejects create_task without a prompt before calling the backend', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'create_task',
      { name: 'child' },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: 'Error: prompt must be a non-empty string' }],
    });
    expect(client.createTask).not.toHaveBeenCalled();
  });

  it('rejects create_task with a blank prompt before calling the backend', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'create_task',
      { name: 'child', prompt: '  ' },
    );

    expect(result).toMatchObject({ isError: true });
    expect(client.createTask).not.toHaveBeenCalled();
  });

  it('rejects create_task with a non-string prompt before calling the backend', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'create_task',
      { name: 'child', prompt: 123 },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: 'Error: prompt must be a non-empty string' }],
    });
    expect(client.createTask).not.toHaveBeenCalled();
  });

  it('passes create_task prompt through to the backend', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'create_task',
      { name: 'child', prompt: 'do the work' },
    );

    expect(result).not.toHaveProperty('isError');
    expect(client.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'child',
        prompt: 'do the work',
        coordinatorTaskId: 'coord-1',
      }),
    );
  });

  it('passes a valid create_task baseBranch through to the backend', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'create_task',
      { name: 'child', prompt: 'do the work', baseBranch: 'feature/base' },
    );

    expect(result).not.toHaveProperty('isError');
    expect(client.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        baseBranch: 'feature/base',
      }),
    );
  });

  it('passes create_task role and roleInstructions through to the backend', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'create_task',
      {
        name: 'child',
        prompt: 'do the work',
        role: 'Reviewer — read-only, do not edit files',
        roleInstructions: 'Report findings; never run git commit.',
      },
    );

    expect(result).not.toHaveProperty('isError');
    expect(client.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'Reviewer — read-only, do not edit files',
        roleInstructions: 'Report findings; never run git commit.',
      }),
    );
  });

  it('omits role and roleInstructions entirely when they were not supplied', async () => {
    const client = makeClient();

    await handleMCPToolCall({ client, taskId: '', coordinatorId: 'coord-1' }, 'create_task', {
      name: 'child',
      prompt: 'do the work',
    });

    const arg = vi.mocked(client.createTask).mock.calls[0][0];
    expect(arg.role).toBeUndefined();
    expect(arg.roleInstructions).toBeUndefined();
  });

  it('rejects a non-string create_task role before calling the backend', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'create_task',
      { name: 'child', prompt: 'do the work', role: 42 },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: 'Error: role must be a string' }],
    });
    expect(client.createTask).not.toHaveBeenCalled();
  });

  it('rejects non-string create_task roleInstructions before calling the backend', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'create_task',
      { name: 'child', prompt: 'do the work', roleInstructions: { text: 'no' } },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: 'Error: roleInstructions must be a string' }],
    });
    expect(client.createTask).not.toHaveBeenCalled();
  });

  it('rejects an invalid create_task baseBranch before calling the backend', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'create_task',
      { name: 'child', prompt: 'do the work', baseBranch: '../main' },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining('baseBranch') }],
    });
    expect(client.createTask).not.toHaveBeenCalled();
  });

  it('returns sent text when send_prompt writes immediately', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'send_prompt',
      { taskId: 'task-1', prompt: 'continue' },
    );

    expect(result).toMatchObject({
      content: [{ text: 'Prompt sent successfully.' }],
    });
    expect(client.sendPrompt).toHaveBeenCalledWith('task-1', 'continue');
  });

  it('rejects send_prompt without a taskId before calling the backend', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'send_prompt',
      { prompt: 'continue' },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: 'Error: taskId must be a non-empty string' }],
    });
    expect(client.sendPrompt).not.toHaveBeenCalled();
  });

  it('rejects send_prompt with a blank taskId before calling the backend', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'send_prompt',
      { taskId: '  ', prompt: 'continue' },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: 'Error: taskId must be a non-empty string' }],
    });
    expect(client.sendPrompt).not.toHaveBeenCalled();
  });

  it('rejects send_prompt with a non-string taskId before calling the backend', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'send_prompt',
      { taskId: 123, prompt: 'continue' },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: 'Error: taskId must be a non-empty string' }],
    });
    expect(client.sendPrompt).not.toHaveBeenCalled();
  });

  it('rejects send_prompt without a prompt before calling the backend', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'send_prompt',
      { taskId: 'task-1' },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: 'Error: prompt must be a non-empty string' }],
    });
    expect(client.sendPrompt).not.toHaveBeenCalled();
  });

  it('rejects send_prompt with a blank prompt before calling the backend', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'send_prompt',
      { taskId: 'task-1', prompt: '  ' },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: 'Error: prompt must be a non-empty string' }],
    });
    expect(client.sendPrompt).not.toHaveBeenCalled();
  });

  it('rejects send_prompt with a non-string prompt before calling the backend', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'send_prompt',
      { taskId: 'task-1', prompt: 123 },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: 'Error: prompt must be a non-empty string' }],
    });
    expect(client.sendPrompt).not.toHaveBeenCalled();
  });

  it('returns queued text when send_prompt is parked behind another prompt', async () => {
    const client = makeClient();
    vi.mocked(client.sendPrompt).mockResolvedValueOnce({ queued: true });

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'send_prompt',
      { taskId: 'task-1', prompt: 'continue' },
    );

    expect(result).toMatchObject({
      content: [{ text: expect.stringContaining('Prompt queued') }],
    });
  });

  it('returns backend send_prompt errors as MCP errors', async () => {
    const client = makeClient();
    vi.mocked(client.sendPrompt).mockRejectedValueOnce(
      new Error('Prompt exceeds 65536 byte limit'),
    );

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'send_prompt',
      { taskId: 'task-1', prompt: 'continue' },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: 'Error: Prompt exceeds 65536 byte limit' }],
    });
  });

  it('returns backend create_task errors as MCP errors', async () => {
    const client = makeClient();
    vi.mocked(client.createTask).mockRejectedValueOnce(
      new Error('coordinator coord-1 is not registered'),
    );

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'create_task',
      { name: 'child', prompt: 'do the work' },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: 'Error: coordinator coord-1 is not registered' }],
    });
  });

  it('rejects send_prompt from sub-task scoped MCP clients', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: 'task-1', coordinatorId: '' },
      'send_prompt',
      { taskId: 'task-2', prompt: 'continue' },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining('not available to sub-tasks') }],
    });
    expect(client.sendPrompt).not.toHaveBeenCalled();
  });
});

describe('relay_to_task tool handling', () => {
  it('rejects relay_to_task from sub-task scoped MCP clients', async () => {
    const client = makeClient();

    // Second enforcement layer. The tool list already hides relay_to_task from
    // sub-tasks, but a sub-task that names the tool anyway must still be
    // refused: the list is advertising, this is the gate.
    const result = await handleMCPToolCall(
      { client, taskId: 'task-1', coordinatorId: '' },
      'relay_to_task',
      { fromTaskId: 'task-2', toTaskId: 'task-3', source: 'output' },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining('not available to sub-tasks') }],
    });
    expect(client.relayToTask).not.toHaveBeenCalled();
  });

  it('names only land_self and signal_done as the sub-task surface when refusing', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: 'task-1', coordinatorId: '' },
      'relay_to_task',
      { fromTaskId: 'task-2', toTaskId: 'task-3', source: 'output' },
    );

    expect(result).toMatchObject({
      content: [{ text: expect.stringContaining('Only land_self and signal_done are permitted') }],
    });
  });

  it('forwards every field to the client for a coordinator caller', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'relay_to_task',
      {
        fromTaskId: 'task-a',
        toTaskId: 'task-b',
        source: 'diff',
        note: 'compare against your branch',
      },
    );

    expect(result).not.toHaveProperty('isError');
    expect(client.relayToTask).toHaveBeenCalledWith('task-b', {
      fromTaskId: 'task-a',
      source: 'diff',
      note: 'compare against your branch',
    });
  });

  it('rejects an unknown source kind before calling the backend', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'relay_to_task',
      { fromTaskId: 'task-a', toTaskId: 'task-b', source: 'everything' },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: 'Error: source must be one of output, diff' }],
    });
    expect(client.relayToTask).not.toHaveBeenCalled();
  });

  it('rejects a missing fromTaskId before calling the backend', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'relay_to_task',
      { toTaskId: 'task-b', source: 'output' },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: 'Error: fromTaskId must be a non-empty string' }],
    });
    expect(client.relayToTask).not.toHaveBeenCalled();
  });

  it('rejects a missing toTaskId before calling the backend', async () => {
    const client = makeClient();

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'relay_to_task',
      { fromTaskId: 'task-a', source: 'output' },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ text: 'Error: toTaskId must be a non-empty string' }],
    });
    expect(client.relayToTask).not.toHaveBeenCalled();
  });

  it('reports truncation back to the coordinator so it knows it saw a slice', async () => {
    const client = makeClient();
    (client.relayToTask as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      queued: false,
      truncated: true,
      sourceBytes: 99_000,
    });

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'relay_to_task',
      { fromTaskId: 'task-a', toTaskId: 'task-b', source: 'diff' },
    );

    expect(result).toMatchObject({
      content: [{ text: expect.stringContaining('truncated') }],
    });
    expect(result.content[0].text).toContain('99000');
  });

  it('says the relay was queued when delivery is deferred', async () => {
    const client = makeClient();
    (client.relayToTask as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      queued: true,
      truncated: false,
    });

    const result = await handleMCPToolCall(
      { client, taskId: '', coordinatorId: 'coord-1' },
      'relay_to_task',
      { fromTaskId: 'task-a', toTaskId: 'task-b', source: 'output' },
    );

    expect(result.content[0].text).toContain('Relay queued');
  });
});
