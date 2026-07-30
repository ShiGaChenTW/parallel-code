import { describe, expect, it } from 'vitest';

import {
  BLOCKED_IMAGE_ALT,
  BLOCKED_IMAGE_ATTR,
  type AttributeBearingNode,
  blockExternalImage,
  isExternalResourceUrl,
  readPersistedOfflineMode,
} from './offline-mode';

/** Minimal stand-in for a DOM element. vitest runs `environment: 'node'`. */
function fakeNode(
  tagName: string,
  attrs: Record<string, string> = {},
): AttributeBearingNode & {
  attrs: Record<string, string>;
} {
  // A Map rather than an object literal: removeAttribute needs a delete, and
  // deleting a dynamically computed key off an object is an ESLint error here.
  const bag = new Map<string, string>(Object.entries(attrs));
  return {
    tagName,
    get attrs() {
      return Object.fromEntries(bag);
    },
    getAttribute: (name) => bag.get(name) ?? null,
    setAttribute: (name, value) => {
      bag.set(name, value);
    },
    removeAttribute: (name) => {
      bag.delete(name);
    },
  };
}

describe('isExternalResourceUrl', () => {
  it('is true for the case PRIVACY.md calls out — an https image in agent-written markdown', () => {
    expect(isExternalResourceUrl('https://tracker.example.com/pixel.png')).toBe(true);
    expect(isExternalResourceUrl('http://tracker.example.com/pixel.png')).toBe(true);
  });

  it('is true for a protocol-relative URL, which a startsWith("http") check misses', () => {
    // `//host/x` inherits the page scheme and does reach out. This is the whole
    // reason the check parses a scheme rather than matching a prefix.
    expect(isExternalResourceUrl('//tracker.example.com/pixel.png')).toBe(true);
  });

  it('is true for ftp, which the renderer will also happily fetch', () => {
    expect(isExternalResourceUrl('ftp://example.com/a.png')).toBe(true);
  });

  it('is case-insensitive about the scheme', () => {
    expect(isExternalResourceUrl('HTTPS://example.com/a.png')).toBe(true);
    expect(isExternalResourceUrl('HtTp://example.com/a.png')).toBe(true);
  });

  it('ignores surrounding whitespace, which HTML attributes tolerate', () => {
    expect(isExternalResourceUrl('  https://example.com/a.png  ')).toBe(true);
  });

  it('is false for data: and blob:, which are already in memory', () => {
    expect(isExternalResourceUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(false);
    expect(isExternalResourceUrl('blob:null/1234')).toBe(false);
  });

  it('is false for file:, which is the local disk and no leak', () => {
    expect(isExternalResourceUrl('file:///Users/x/shot.png')).toBe(false);
  });

  it('is false for relative references, which resolve against the app origin', () => {
    expect(isExternalResourceUrl('./screenshot.png')).toBe(false);
    expect(isExternalResourceUrl('../docs/a.png')).toBe(false);
    expect(isExternalResourceUrl('/assets/a.png')).toBe(false);
    expect(isExternalResourceUrl('shot.png')).toBe(false);
  });

  it('treats a Windows-style path as relative, not as a "c:" scheme', () => {
    // A single letter before the colon is a drive, not a scheme worth blocking;
    // either way it is local, so the answer is the same.
    expect(isExternalResourceUrl('C:/Users/x/shot.png')).toBe(false);
  });

  it('is false for the empty string rather than throwing', () => {
    expect(isExternalResourceUrl('')).toBe(false);
    expect(isExternalResourceUrl('   ')).toBe(false);
  });
});

describe('the blocked-image markers', () => {
  it('names the switch in the alt text, so a missing image is not read as a broken one', () => {
    expect(BLOCKED_IMAGE_ALT).toContain('offline mode');
  });

  it('uses a data-* attribute, which DOMPurify keeps by default', () => {
    expect(BLOCKED_IMAGE_ATTR.startsWith('data-')).toBe(true);
  });
});

describe('readPersistedOfflineMode', () => {
  it('is off when the field is absent, so upgrading changes nothing', () => {
    expect(readPersistedOfflineMode(undefined)).toBe(false);
    expect(readPersistedOfflineMode(null)).toBe(false);
  });

  it('requires a literal true — a truthy value in a corrupt file is not consent', () => {
    expect(readPersistedOfflineMode(true)).toBe(true);
    expect(readPersistedOfflineMode(false)).toBe(false);
    expect(readPersistedOfflineMode('true')).toBe(false);
    expect(readPersistedOfflineMode(1)).toBe(false);
    expect(readPersistedOfflineMode({})).toBe(false);
  });
});

describe('blockExternalImage', () => {
  it('drops the src of an external image, so the renderer never fetches it', () => {
    const node = fakeNode('IMG', { src: 'https://tracker.example.com/pixel.png' });
    expect(blockExternalImage(node)).toBe(true);
    expect(node.getAttribute('src')).toBeNull();
  });

  it('drops srcset too — otherwise a responsive image still reaches the host', () => {
    const node = fakeNode('IMG', {
      src: 'https://tracker.example.com/a.png',
      srcset: 'https://tracker.example.com/a@2x.png 2x',
    });
    blockExternalImage(node);
    expect(node.getAttribute('srcset')).toBeNull();
  });

  it('explains itself in the alt text rather than leaving a silent gap', () => {
    const node = fakeNode('IMG', { src: 'https://tracker.example.com/a.png' });
    blockExternalImage(node);
    expect(node.getAttribute('alt')).toBe(BLOCKED_IMAGE_ALT);
    expect(node.getAttribute(BLOCKED_IMAGE_ATTR)).toBe('true');
  });

  it('leaves a local image completely alone — it makes no request', () => {
    const node = fakeNode('IMG', { src: './screenshot.png', alt: 'a shot' });
    expect(blockExternalImage(node)).toBe(false);
    expect(node.getAttribute('src')).toBe('./screenshot.png');
    expect(node.getAttribute('alt')).toBe('a shot');
  });

  it('leaves a data: image alone — it is already in memory', () => {
    const node = fakeNode('IMG', { src: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(blockExternalImage(node)).toBe(false);
  });

  it('ignores non-images, including an anchor to the same host', () => {
    const anchor = fakeNode('A', { href: 'https://example.com' });
    expect(blockExternalImage(anchor)).toBe(false);
    expect(anchor.getAttribute('href')).toBe('https://example.com');
  });

  it('ignores an img with no src at all', () => {
    expect(blockExternalImage(fakeNode('IMG'))).toBe(false);
  });

  it('matches the tag case-insensitively, as DOM and XHTML differ', () => {
    const lower = fakeNode('img', { src: 'https://tracker.example.com/a.png' });
    expect(blockExternalImage(lower)).toBe(true);
  });
});
