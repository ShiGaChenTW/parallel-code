import { describe, expect, it } from 'vitest';
import { selectTools, SUBTASK_TOOLS, COORDINATOR_TOOLS, type ToolDef } from './mcp-tool-list.js';

describe('selectTools — role-based tool list', () => {
  it('sub-task (taskId set, no coordinatorId) gets only sub-task tools', () => {
    const tools = selectTools('task-abc', '');
    expect(tools).toEqual(SUBTASK_TOOLS);
    expect(tools.map((t: ToolDef) => t.name)).toStrictEqual(['land_self', 'signal_done']);
  });

  it('coordinator (coordinatorId set, no taskId) gets coordinator tools', () => {
    const tools = selectTools('', 'coordinator-xyz');
    expect(tools).toEqual(COORDINATOR_TOOLS);
  });

  it('coordinator tools do NOT include signal_done', () => {
    const tools = selectTools('', 'coordinator-xyz');
    expect(tools.map((t: ToolDef) => t.name)).not.toContain('signal_done');
  });

  it('coordinator tools include the expected lifecycle tools', () => {
    const names = selectTools('', 'coordinator-xyz').map((t: ToolDef) => t.name);
    for (const expected of [
      'create_task',
      'list_tasks',
      'get_task_status',
      'send_prompt',
      'wait_for_idle',
      'wait_for_signal_done',
      'get_task_diff',
      'get_task_output',
      'merge_task',
      'close_task',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('does not advertise deprecated review_and_merge_task', () => {
    const names = selectTools('', 'coordinator-xyz').map((t: ToolDef) => t.name);
    expect(names).not.toContain('review_and_merge_task');
  });

  it('plain agent (neither taskId nor coordinatorId) gets coordinator tools', () => {
    const tools = selectTools('', '');
    expect(tools).toEqual(COORDINATOR_TOOLS);
  });

  it('coordinator tool descriptions warn against resending assignments from startup placeholders', () => {
    const byName = new Map(COORDINATOR_TOOLS.map((tool) => [tool.name, tool.description]));
    expect(byName.get('create_task')).toContain('startup/default placeholder');
    expect(byName.get('send_prompt')).toContain('Do not resend the full original assignment');
    expect(byName.get('get_task_output')).toContain('Improve documentation in @filename');
  });

  it('create_task documents the coordinator branch as the default base branch', () => {
    const createTask = COORDINATOR_TOOLS.find((tool) => tool.name === 'create_task');
    const properties = createTask?.inputSchema.properties as
      | Record<string, { description?: string }>
      | undefined;
    expect(properties?.baseBranch?.description).toContain(
      'Defaults to the coordinator task branch',
    );
  });

  it('create_task requires an initial prompt', () => {
    const createTask = COORDINATOR_TOOLS.find((tool) => tool.name === 'create_task');
    expect(createTask?.inputSchema.required).toContain('prompt');
  });

  it('create_task declares prompt as a string input', () => {
    const createTask = COORDINATOR_TOOLS.find((tool) => tool.name === 'create_task');
    const properties = createTask?.inputSchema.properties as
      | Record<string, { type?: string }>
      | undefined;
    expect(properties?.prompt?.type).toBe('string');
  });

  it('create_task exposes role and roleInstructions as optional free-text strings', () => {
    const createTask = COORDINATOR_TOOLS.find((tool) => tool.name === 'create_task');
    const properties = createTask?.inputSchema.properties as
      | Record<string, { type?: string }>
      | undefined;

    expect(properties?.role?.type).toBe('string');
    expect(properties?.roleInstructions?.type).toBe('string');
    expect(createTask?.inputSchema.required).not.toContain('role');
    expect(createTask?.inputSchema.required).not.toContain('roleInstructions');
  });

  it('does not constrain role to a fixed set of values', () => {
    // Decision 2: free text, not an enum. A fixed enum is only meaningful if it
    // binds tool permissions, which selectTools does not do.
    const createTask = COORDINATOR_TOOLS.find((tool) => tool.name === 'create_task');
    const properties = createTask?.inputSchema.properties as
      | Record<string, Record<string, unknown>>
      | undefined;

    expect(properties?.role).not.toHaveProperty('enum');
    expect(properties?.roleInstructions).not.toHaveProperty('enum');
  });

  it('documents the role as advisory rather than tool-enforced', () => {
    const createTask = COORDINATOR_TOOLS.find((tool) => tool.name === 'create_task');
    const properties = createTask?.inputSchema.properties as
      | Record<string, { description?: string }>
      | undefined;

    expect(properties?.role?.description).toMatch(/free text/i);
    expect(properties?.role?.description).toMatch(/not enforced/i);
  });

  it('send_prompt requires a prompt', () => {
    const sendPrompt = COORDINATOR_TOOLS.find((tool) => tool.name === 'send_prompt');
    expect(sendPrompt?.inputSchema.required).toContain('prompt');
  });

  it('send_prompt requires a taskId', () => {
    const sendPrompt = COORDINATOR_TOOLS.find((tool) => tool.name === 'send_prompt');
    expect(sendPrompt?.inputSchema.required).toContain('taskId');
  });

  it('send_prompt declares taskId and prompt as string inputs', () => {
    const sendPrompt = COORDINATOR_TOOLS.find((tool) => tool.name === 'send_prompt');
    const properties = sendPrompt?.inputSchema.properties as
      | Record<string, { type?: string }>
      | undefined;
    expect(properties?.taskId?.type).toBe('string');
    expect(properties?.prompt?.type).toBe('string');
  });

  it('sub-task tools do NOT include any coordinator lifecycle tools', () => {
    const names = selectTools('task-abc', '').map((t: ToolDef) => t.name);
    for (const forbidden of ['create_task', 'merge_task', 'close_task', 'wait_for_signal_done']) {
      expect(names).not.toContain(forbidden);
    }
  });
});

describe('relay_to_task — coordinator-only by construction', () => {
  it('is offered to coordinators', () => {
    expect(selectTools('', 'coordinator-xyz').map((t: ToolDef) => t.name)).toContain(
      'relay_to_task',
    );
  });

  it('is absent from SUBTASK_TOOLS, which still holds exactly two tools', () => {
    // The invariant stated two ways, so a future edit cannot satisfy one and
    // quietly break the other: relay is not in the list, and the list has not
    // grown.
    expect(SUBTASK_TOOLS.map((t: ToolDef) => t.name)).toStrictEqual(['land_self', 'signal_done']);
    expect(SUBTASK_TOOLS.map((t: ToolDef) => t.name)).not.toContain('relay_to_task');
  });

  it('is not visible to a sub-task caller', () => {
    // `writeToAgent` has no per-caller authorisation, so a sub-task able to
    // nominate an arbitrary target task could drive any task in the workspace.
    // An upward request (`ask_coordinator`) is a separate, later decision;
    // sideways is never allowed.
    expect(selectTools('task-abc', '').map((t: ToolDef) => t.name)).not.toContain('relay_to_task');
  });

  it('offers no tool at all that lets a sub-task address another task', () => {
    const names = selectTools('task-abc', '').map((t: ToolDef) => t.name);
    for (const forbidden of ['relay_to_task', 'send_prompt', 'send_to_task', 'ask_coordinator']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('requires both endpoints and the source kind', () => {
    const relay = COORDINATOR_TOOLS.find((tool) => tool.name === 'relay_to_task');
    expect(relay?.inputSchema.required).toStrictEqual(['fromTaskId', 'toTaskId', 'source']);
  });

  it('constrains source to output or diff', () => {
    const relay = COORDINATOR_TOOLS.find((tool) => tool.name === 'relay_to_task');
    const properties = relay?.inputSchema.properties as
      | Record<string, Record<string, unknown>>
      | undefined;
    expect(properties?.source?.enum).toStrictEqual(['output', 'diff']);
  });

  it('declares the note as optional free text', () => {
    const relay = COORDINATOR_TOOLS.find((tool) => tool.name === 'relay_to_task');
    const properties = relay?.inputSchema.properties as
      | Record<string, { type?: string }>
      | undefined;
    expect(properties?.note?.type).toBe('string');
    expect(relay?.inputSchema.required).not.toContain('note');
  });

  it('tells the coordinator the relay is scoped to its own sub-tasks', () => {
    const relay = COORDINATOR_TOOLS.find((tool) => tool.name === 'relay_to_task');
    expect(relay?.description).toContain('sub-tasks of the same coordinator');
  });

  it('tells the coordinator the content arrives labelled as quoted data', () => {
    const relay = COORDINATOR_TOOLS.find((tool) => tool.name === 'relay_to_task');
    expect(relay?.description).toContain('quoted data');
  });
});
