import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  OUTBOUND_SURFACES,
  OfflineModeError,
  assertOnline,
  isOfflineMode,
  offlineMessage,
  parsePersistedOfflineMode,
  setOfflineMode,
} from './offline.js';

// The gate is module-level state shared across this file and every surface
// suite. Both hooks run so a test never inherits a value and never leaves one.
beforeEach(() => setOfflineMode(false));
afterEach(() => setOfflineMode(false));

describe('the switch itself', () => {
  it('is off by default, so a first run behaves as it did before the feature', () => {
    expect(isOfflineMode()).toBe(false);
  });

  it('is reversible — unlike the gh-missing latch in pr-checks', () => {
    setOfflineMode(true);
    expect(isOfflineMode()).toBe(true);
    setOfflineMode(false);
    expect(isOfflineMode()).toBe(false);
  });
});

describe('assertOnline', () => {
  it('does nothing while the switch is off', () => {
    expect(() => assertOnline('huly')).not.toThrow();
  });

  it('throws an identifiable error naming the surface while the switch is on', () => {
    setOfflineMode(true);
    try {
      assertOnline('huly');
      expect.unreachable('assertOnline should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(OfflineModeError);
      expect((err as OfflineModeError).surface).toBe('huly');
      expect((err as OfflineModeError).code).toBe('ERR_OFFLINE_MODE');
    }
  });
});

describe('offlineMessage', () => {
  it('covers every surface with a distinct sentence', () => {
    const messages = OUTBOUND_SURFACES.map((s) => offlineMessage(s));
    expect(new Set(messages).size).toBe(OUTBOUND_SURFACES.length);
  });

  it('always says how to undo it — a blocked action with no remedy is a dead end', () => {
    for (const surface of OUTBOUND_SURFACES) {
      expect(offlineMessage(surface)).toContain('Turn it off in Settings');
    }
  });
});

describe('OUTBOUND_SURFACES', () => {
  it('has no duplicate ids', () => {
    expect(new Set(OUTBOUND_SURFACES).size).toBe(OUTBOUND_SURFACES.length);
  });
});

// This array is the single source of truth for how many surfaces the switch
// covers. PRIVACY.md and PRD 7.1 both quote that number in prose, and both
// undercounted before this change — PRD said three, and the brief for the work
// said six. These tests derive the expected number from the array rather than
// restating it, so the documentation is checked against the code and not
// against a second copy of the same claim.
describe('the documented surface count matches the code', () => {
  const repoRoot = join(__dirname, '..', '..');
  const asWords: Record<number, string> = {
    3: 'three',
    4: 'four',
    5: 'five',
    6: 'six',
    7: 'seven',
    8: 'eight',
    9: 'nine',
    10: 'ten',
    11: 'eleven',
  };

  it('has an English word available for the current count', () => {
    // Guards the two tests below from silently passing on `undefined`.
    expect(asWords[OUTBOUND_SURFACES.length]).toBeTruthy();
  });

  it('PRIVACY.md states the same number', () => {
    const privacy = readFileSync(join(repoRoot, 'PRIVACY.md'), 'utf8');
    expect(privacy).toContain(`**${asWords[OUTBOUND_SURFACES.length]}**`);
  });

  it('PRIVACY.md documents the offline behaviour of every surface', () => {
    const privacy = readFileSync(join(repoRoot, 'PRIVACY.md'), 'utf8');
    // One "Offline mode:" note per governed bullet. The bullets group the two
    // git surfaces together, so the note count is one below the surface count.
    const notes = privacy.match(/\*\*Offline mode:\*\*/g) ?? [];
    expect(notes.length).toBe(OUTBOUND_SURFACES.length - 1);
  });

  it('PRD 7.1 lists exactly the surfaces the code covers', () => {
    const prd = readFileSync(join(repoRoot, 'docs', 'PRD.md'), 'utf8');
    const section = prd.slice(prd.indexOf('### 7.1'), prd.indexOf('### 7.2'));
    for (let n = 1; n <= OUTBOUND_SURFACES.length; n++) {
      expect(section, `PRD 7.1 is missing list item ${n}`).toContain(`  ${n}. `);
    }
    expect(section).not.toContain(`  ${OUTBOUND_SURFACES.length + 1}. `);
  });

  it('PRD 7.1 states the boundary that third-party CLI traffic is not covered', () => {
    const prd = readFileSync(join(repoRoot, 'docs', 'PRD.md'), 'utf8');
    const section = prd.slice(prd.indexOf('### 7.1'), prd.indexOf('### 7.2'));
    expect(section).toContain('不涵蓋');
  });
});

describe('parsePersistedOfflineMode', () => {
  it('reads the switch out of a state.json payload', () => {
    expect(parsePersistedOfflineMode('{"offlineMode":true}')).toBe(true);
    expect(parsePersistedOfflineMode('{"offlineMode":false}')).toBe(false);
  });

  it('treats an absent field as off, so upgrading keeps prior behaviour', () => {
    expect(parsePersistedOfflineMode('{"tasks":{}}')).toBe(false);
  });

  it('requires a literal true — a truthy string is a corrupt file, not consent', () => {
    expect(parsePersistedOfflineMode('{"offlineMode":"yes"}')).toBe(false);
    expect(parsePersistedOfflineMode('{"offlineMode":1}')).toBe(false);
  });

  it('survives unreadable input rather than throwing during startup', () => {
    expect(parsePersistedOfflineMode(null)).toBe(false);
    expect(parsePersistedOfflineMode(undefined)).toBe(false);
    expect(parsePersistedOfflineMode('')).toBe(false);
    expect(parsePersistedOfflineMode('not json')).toBe(false);
    expect(parsePersistedOfflineMode('[]')).toBe(false);
    expect(parsePersistedOfflineMode('null')).toBe(false);
  });
});
