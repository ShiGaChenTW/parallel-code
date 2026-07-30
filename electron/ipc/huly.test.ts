import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/huly-test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.from(''),
    decryptString: () => '',
  },
}));

const { mapIssue, parseCredentials } = await import('./huly.js');

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
