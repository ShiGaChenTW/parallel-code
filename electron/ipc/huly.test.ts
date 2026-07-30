import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/huly-test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.from(''),
    decryptString: () => '',
  },
}));

const {
  isModelTransactionWarning,
  listIssues,
  mapIssue,
  parseCredentials,
  testConnection,
  withSuppressedModelWarnings,
} = await import('./huly.js');
const { setOfflineMode } = await import('./offline.js');

describe('parseCredentials', () => {
  const valid = { url: 'https://huly.example.com', workspace: 'ws', token: 'tok' };

  it('accepts a complete https credential set', () => {
    expect(parseCredentials(JSON.stringify(valid))).toEqual(valid);
  });

  it('trims surrounding whitespace so a pasted token still works', () => {
    const parsed = parseCredentials(
      JSON.stringify({ url: ' https://huly.example.com ', workspace: ' ws ', token: ' tok ' }),
    );
    expect(parsed).toEqual(valid);
  });

  it('allows http on loopback for a local Huly instance', () => {
    expect(parseCredentials(JSON.stringify({ ...valid, url: 'http://localhost:8087' }))).toEqual({
      ...valid,
      url: 'http://localhost:8087',
    });
    expect(
      parseCredentials(JSON.stringify({ ...valid, url: 'http://127.0.0.1:8087' })),
    ).not.toBeNull();
  });

  it('rejects plain http to a remote host — the token is a bearer credential', () => {
    expect(
      parseCredentials(JSON.stringify({ ...valid, url: 'http://huly.example.com' })),
    ).toBeNull();
  });

  it('rejects a missing field rather than half-configuring a connection', () => {
    const withoutUrl = { workspace: valid.workspace, token: valid.token };
    const withoutWorkspace = { url: valid.url, token: valid.token };
    const withoutToken = { url: valid.url, workspace: valid.workspace };
    expect(parseCredentials(JSON.stringify(withoutUrl)), 'missing url').toBeNull();
    expect(parseCredentials(JSON.stringify(withoutWorkspace)), 'missing workspace').toBeNull();
    expect(parseCredentials(JSON.stringify(withoutToken)), 'missing token').toBeNull();
  });

  it('rejects an empty or whitespace-only field', () => {
    expect(parseCredentials(JSON.stringify({ ...valid, token: '' }))).toBeNull();
    expect(parseCredentials(JSON.stringify({ ...valid, token: '   ' }))).toBeNull();
  });

  it('rejects a non-string field, so a hand-edited file cannot inject a shape', () => {
    expect(parseCredentials(JSON.stringify({ ...valid, token: 42 }))).toBeNull();
  });

  it('rejects malformed JSON rather than throwing', () => {
    expect(parseCredentials('{ not json')).toBeNull();
    expect(parseCredentials('')).toBeNull();
    expect(parseCredentials('null')).toBeNull();
    expect(parseCredentials('"a string"')).toBeNull();
  });
});

describe('mapIssue', () => {
  it('keeps the fields the app stores and renders', () => {
    expect(
      mapIssue({
        _id: 'abc',
        identifier: 'FK_PC-1',
        title: 'Remove monaco',
        status: 'tracker:status:Done',
        modifiedOn: 1700000000000,
      }),
    ).toEqual({
      id: 'abc',
      identifier: 'FK_PC-1',
      title: 'Remove monaco',
      status: 'tracker:status:Done',
      modifiedOn: 1700000000000,
    });
  });

  it('drops a document with no id or identifier — it cannot be linked to a task', () => {
    expect(mapIssue({ _id: 'abc' })).toBeNull();
    expect(mapIssue({ _id: 42, identifier: 'FK_PC-1' })).toBeNull();
  });

  it('defaults missing optional fields instead of propagating undefined into the UI', () => {
    expect(mapIssue({ _id: 'abc', identifier: 'FK_PC-9' })).toEqual({
      id: 'abc',
      identifier: 'FK_PC-9',
      title: '',
      status: '',
      modifiedOn: 0,
    });
  });
});

describe('withSuppressedModelWarnings', () => {
  it('filters the client noise from warn — the stream the client actually uses', async () => {
    const kept: unknown[][] = [];
    const sink = { warn: (...args: unknown[]) => kept.push(args) };
    await withSuppressedModelWarnings(async () => {
      sink.warn('no document found, failed to apply model transaction, skipping _id="x"');
      sink.warn('something a user should see');
    }, sink);
    expect(kept).toEqual([['something a user should see']]);
  });

  it('restores the original warn even when the body throws', async () => {
    const original = () => undefined;
    const sink = { warn: original };
    await expect(
      withSuppressedModelWarnings(async () => {
        throw new Error('connect failed');
      }, sink),
    ).rejects.toThrow('connect failed');
    expect(sink.warn).toBe(original);
  });

  it('returns the body result', async () => {
    const sink = { warn: () => undefined };
    await expect(withSuppressedModelWarnings(async () => 42, sink)).resolves.toBe(42);
  });
});

describe('isModelTransactionWarning', () => {
  it('matches the client noise', () => {
    expect(
      isModelTransactionWarning('no document found, failed to apply model transaction, skipping'),
    ).toBe(true);
  });

  it('does not match unrelated warnings, which must stay visible', () => {
    expect(isModelTransactionWarning('websocket closed unexpectedly')).toBe(false);
    expect(isModelTransactionWarning(undefined)).toBe(false);
    expect(isModelTransactionWarning(42)).toBe(false);
  });
});

describe('offline mode', () => {
  beforeEach(() => setOfflineMode(false));
  afterEach(() => setOfflineMode(false));

  // Both public entry points are guarded ahead of the lazy `import()` of the
  // several-MB @hcengineering client, so the switch spares the module load as
  // well as the socket. If the guard moved below the import this test would
  // still pass but would take seconds — the assertion is on the rejection.
  it('refuses to list issues rather than opening a WebSocket', async () => {
    setOfflineMode(true);
    await expect(listIssues('FK_PC')).rejects.toThrow(/Offline mode is on/);
  });

  it('refuses the Settings connection test with the same message', async () => {
    setOfflineMode(true);
    await expect(testConnection()).rejects.toThrow(/Offline mode is on/);
  });

  it('says how to undo it, so the Settings dialog is not a dead end', async () => {
    setOfflineMode(true);
    await expect(testConnection()).rejects.toThrow(/Turn it off in Settings/);
  });

  it('falls back to the ordinary not-configured error once the switch is off', async () => {
    setOfflineMode(false);
    // No credentials are stored in this suite (safeStorage is mocked as
    // unavailable), so the next failure is the pre-existing one.
    await expect(listIssues('FK_PC')).rejects.toThrow(/not configured/);
  });
});
