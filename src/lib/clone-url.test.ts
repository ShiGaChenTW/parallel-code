import { describe, expect, it } from 'vitest';

import { normalizeCloneUrl, suggestedFolderName } from './clone-url';

/**
 * The renderer copy, tested through the behaviour the dialog actually depends
 * on: whether the Clone button lights up, and what the folder field pre-fills.
 *
 * Character-level agreement with the main-process copy is asserted separately,
 * in `parity with the renderer copy` (electron/ipc/clone-url.test.ts). These
 * two suites are complementary: parity proves the copies are the same, and this
 * proves the thing they both are is right from where the UI stands.
 */
describe('normalizeCloneUrl, as the Clone button reads it', () => {
  it('enables the button for every form the dialog advertises', () => {
    // The hint under the field promises these four. If any stops working the
    // hint is a lie, which is worse than the field being stricter.
    for (const url of [
      'https://github.com/solidjs/solid.git',
      'https://github.com/solidjs/solid',
      'git@github.com:solidjs/solid.git',
      'solidjs/solid',
    ]) {
      expect(normalizeCloneUrl(url), url).not.toBeNull();
    }
  });

  it('keeps the button disabled while the field is empty or half-typed', () => {
    for (const url of ['', '   ', 'h', 'https:/', 'https://', 'ssh://', 'solid']) {
      expect(normalizeCloneUrl(url), JSON.stringify(url)).toBeNull();
    }
  });

  it('keeps the button disabled for transports the app refuses', () => {
    // These would otherwise light the button up and then fail in the main
    // process, telling the user to fix something the UI said was fine.
    for (const url of [
      'ext::sh -c whoami',
      'file:///etc/passwd',
      'git://github.com/a/b.git',
      'http://github.com/a/b.git',
      '--upload-pack=touch /tmp/x',
      '/Users/x/code/thing',
      '../thing',
    ]) {
      expect(normalizeCloneUrl(url), url).toBeNull();
    }
  });
});

describe('suggestedFolderName, as the folder field reads it', () => {
  it('names the folder after the repository', () => {
    expect(suggestedFolderName('https://github.com/solidjs/solid.git')).toBe('solid');
    expect(suggestedFolderName('git@github.com:solidjs/solid.git')).toBe('solid');
    expect(suggestedFolderName('solidjs/solid')).toBe('solid');
    expect(suggestedFolderName('https://github.com/vercel/next.js.git')).toBe('next.js');
  });

  it('returns a string for every input, since it binds to an input value', () => {
    // `null` here would render the literal text "null" in the box.
    for (const url of ['', '   ', 'htt', 'https://github.com/', 'ext::sh -c x']) {
      expect(typeof suggestedFolderName(url), JSON.stringify(url)).toBe('string');
    }
  });

  it('never suggests a name that would escape the destination', () => {
    for (const url of ['https://github.com/o/..', 'git@github.com:o/..', 'https://a/b/.']) {
      const name = suggestedFolderName(url);
      expect(name).not.toBe('..');
      expect(name).not.toBe('.');
      expect(name).not.toContain('/');
      expect(name).not.toContain('\\');
    }
  });
});
