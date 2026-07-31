import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { IPC } from './ipc/channels.js';

const require = createRequire(import.meta.url);
const IPC_MANIFEST = require('./ipc/channel-manifest.json') as Record<string, string>;

describe('preload ALLOWED_CHANNELS', () => {
  const preloadSrc = readFileSync(join(__dirname, 'preload.cjs'), 'utf8');
  const extractPreloadChannels = (): string[] => {
    const match = /new Set\(\[([\s\S]*?)\]\)/.exec(preloadSrc);
    if (!match) throw new Error('preload.cjs ALLOWED_CHANNELS literal not found');
    return [...match[1].matchAll(/'([^']+)'/g)].map((channelMatch) => channelMatch[1]);
  };

  it('uses a sandbox-safe inline allowlist', () => {
    expect(preloadSrc).not.toContain("require('./ipc/channel-manifest.json')");
    expect(preloadSrc).toContain('sandboxed preloads cannot require arbitrary local JSON');
  });

  // There are only two hand-maintained artifacts here, not three. `channels.ts`
  // is `export const IPC = channelManifest` — a verbatim re-export — so the
  // manifest and the IPC enum cannot drift while that line stands, and a test
  // named as though it cross-checked three independent sources overstated its
  // reach. The two checks below say what each one actually guards.

  it('exposes the manifest through IPC verbatim, key for key', () => {
    // `IPC_MANIFEST` is a separate `createRequire` read of the JSON, so this is
    // not an object compared with itself: it goes red the moment `channels.ts`
    // stops being a pure re-export — adding, dropping, or renaming a key on the
    // way through. Comparing the full key→value mapping rather than just the
    // values is deliberate; callers reach channels as `IPC.SpawnAgent`, so a
    // renamed key breaks them while leaving the value set identical.
    expect({ ...IPC }).toEqual(IPC_MANIFEST);
    expect(Object.keys(IPC)).toHaveLength(Object.keys(IPC_MANIFEST).length);

    const IPC_CHANNELS = Object.values(IPC_MANIFEST);
    expect(new Set(IPC_CHANNELS).size).toBe(IPC_CHANNELS.length);
  });

  it('keeps the preload allowlist an exact set copy of the manifest', () => {
    // This is the pair that genuinely can drift: preload.cjs cannot require the
    // manifest under a sandboxed preload, so its list is retyped by hand.
    const channels = Object.values(IPC);
    const preloadChannels = extractPreloadChannels();
    expect(new Set(preloadChannels)).toEqual(new Set(channels));
    expect(preloadChannels).toHaveLength(channels.length);
    expect(new Set(preloadChannels).size).toBe(preloadChannels.length);
  });

  it('packages the preload artifact', () => {
    const packageJson = require('../package.json') as { build?: { files?: string[] } };
    expect(packageJson.build?.files).toContain('electron/preload.cjs');
  });
});
