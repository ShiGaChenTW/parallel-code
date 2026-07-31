import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { catalogueFor } from './i18n';

/**
 * The gate that stops the Traditional Chinese catalogue drifting behind the UI.
 *
 * The i18n wave translated what existed at the time and shipped no check. Every
 * wave after it added UI strings — a transcript switch, an AI usage table, a
 * font picker — and each one silently widened the gap, because `translate()`
 * falls back to the English source. That fallback is deliberate and stays: an
 * untranslated string should degrade to readable English rather than a blank or
 * a raw id. It just means nothing goes red, so this file has to.
 *
 * It reads source text rather than importing components: vitest runs with
 * `environment: 'node'` and no DOM, so a `.tsx` module cannot be imported here
 * at all. Scanning text also means a call site is covered the moment it is
 * written, with no registration step for the ordinary case.
 *
 * Four checks, in the order a string can escape:
 *
 *  1. every `tr('…')` with a literal key is translated;
 *  2. every `tr(expression)` — where the key is not visible to a scanner —
 *     lives in a file on `DYNAMIC_TR_SOURCES`, so the escape hatch is a
 *     reviewed list rather than an accident;
 *  3. every key those dynamic sites can produce is translated, and still
 *     exists in the module the register says it comes from;
 *  4. no sentence-length catalogue entry is stranded — translated once and then
 *     left sitting in JSX outside `tr()`, or orphaned by an edit to the English.
 *
 * Deliberate non-translation is a first-class answer. Product and vendor names,
 * git vocabulary this audience reads in English, and CLI agent names go on
 * `KEPT_IN_ENGLISH` with a reason. A gate that forces someone to translate
 * `Docker` is worse than no gate.
 */

const SRC = resolve(__dirname, '..');

/**
 * Keys `tr()` is called with that are meant to stay English.
 *
 * They are absent from the catalogue rather than mapped to themselves, because
 * a self-mapping entry reads like a translation somebody finished. `translate()`
 * returns the source text for anything it does not know, so the UI is already
 * correct — this list only records that the absence was a decision.
 */
const KEPT_IN_ENGLISH: readonly string[] = [
  // Feature name, shown as-is throughout the UI and in the MCP tool names.
  'Coordinator',
  // git vocabulary. The catalogue maps the plural heading 'Worktrees' to the
  // English singular for the same reason: the word itself does not translate.
  'Worktree',
];

/**
 * Call sites where the key is an expression, and the keys each one can produce.
 *
 * `keys` is not documentation — every entry is asserted to be translated and to
 * still exist as a string literal in `from`, so renaming a label in a data table
 * without revisiting this file fails here rather than in the UI.
 */
interface DynamicTrSource {
  /** Why the key cannot be a literal at the call site. */
  readonly note: string;
  /** Module that supplies the keys → the keys it supplies. */
  readonly keys: Readonly<Record<string, readonly string[]>>;
}

const DEPENDENCY_BLOCK_KEYS = [
  'Blocked — waiting for {task} to land.',
  'Blocked — the task this one depends on was removed.',
  "Blocked — this task's dependency chain loops back on itself.",
];

const DYNAMIC_TR_SOURCES: Readonly<Record<string, DynamicTrSource>> = {
  'src/components/CloseTaskDialog.tsx': {
    note: '`Emphasised` renders a one-slot sentence handed to it as a `template` prop.',
    keys: {
      'src/components/CloseTaskDialog.tsx': [
        'Local feature branch {branch}',
        'Worktree at {path}',
        'Branch {branch} will be kept',
      ],
    },
  },
  'src/components/OnboardingChecklist.tsx': {
    note: 'Step labels come from `onboardingSteps`, which is pure and cannot read the locale.',
    keys: {
      'src/lib/onboarding.ts': [
        'Link a project',
        'Create a task',
        'Review the diff',
        'Merge it back',
      ],
    },
  },
  'src/components/SettingsDialog.tsx': {
    note: 'Font notes come from the CJK font table; the appearance mode is a union member; the font install message is a descriptor from `planCjkFontSelection`, which `cjk-fonts.test.ts` pins separately.',
    keys: {
      'src/lib/cjk-fonts.ts': [
        'Built for terminals; CJK sits at exactly twice the Latin width',
        'Stricter monospacing than Sarasa Term, same CJK coverage',
        'Rounded, with ligatures and Nerd Font icons',
        'Conservative and broadly compatible',
        'Calligraphic; easiest on the eyes over long sessions',
      ],
      'src/lib/look.ts': ['light', 'dark', 'system'],
    },
  },
  'src/components/Sidebar.tsx': {
    note: 'Dependency block sentence is a descriptor from `dependencyBlockMessage`.',
    keys: { 'src/lib/task-dependency.ts': DEPENDENCY_BLOCK_KEYS },
  },
  'src/components/TaskNotesBody.tsx': {
    note: 'Tab labels are a lookup keyed by the active tab. The empty state and the header summary are descriptors from `transcript-timeline.ts`, which is pure.',
    keys: {
      'src/components/TaskNotesBody.tsx': ['Notes', 'Plan', 'Handoff', 'Timeline'],
      'src/lib/transcript-timeline.ts': [
        'No events recorded for this task yet.',
        'Session transcripts are off. Turn on Settings → Privacy → Record session transcripts to start recording this task.',
        '{count} event',
        '{count} events',
        '{count} event · {masked} with redacted content',
        '{count} events · {masked} with redacted content',
      ],
    },
  },
  'src/components/TerminalBookmarks.tsx': {
    note: 'Bookmark count picks between two literal sentences; the direction word is a union member.',
    keys: { 'src/components/TerminalBookmarks.tsx': ['above', 'below'] },
  },
  'src/components/TerminalView.tsx': {
    note: 'Dependency block sentence is a descriptor from `dependencyBlockMessage`.',
    keys: { 'src/lib/task-dependency.ts': DEPENDENCY_BLOCK_KEYS },
  },
  'src/components/TokenUsageSection.tsx': {
    note: 'The CLI summary line is a list of descriptors from `describeProviders`.',
    keys: {
      'src/lib/token-usage-format.ts': [
        'No usage logs have been read yet.',
        'Reading {providers}.',
        'No AI CLI logs found.',
        '{providers} not installed.',
        'Could not read {providers}.',
      ],
    },
  },
  'src/store/cjkFont.ts': {
    note: 'Install outcome is a descriptor from `planCjkFontSelection`; `cjk-fonts.test.ts` pins those sentences against the catalogue directly.',
    keys: {},
  },
};

/**
 * Below this length a catalogue key is a label, and a label collides with
 * ordinary source text — `Copy`, `Open`, `Running` all appear as identifiers and
 * as substrings of longer words. Sentence-length entries do not collide, so
 * check 4 applies to those only. The two real defects it was written to catch
 * (a Docker paragraph and an update notice, both translated and both sitting
 * raw in JSX) are 104 and 154 characters.
 */
const SENTENCE_LENGTH = 40;

// --- source scanning -------------------------------------------------------

interface TrCall {
  readonly file: string;
  readonly line: number;
  readonly keys: readonly string[] | null;
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
  };
  walk(SRC);
  return out;
}

const ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '`': '`',
  '\n': '',
};

/**
 * Read the string literal starting at `start`, or null if that is not one.
 *
 * `value` is null for a template literal carrying a substitution: it is an
 * expression, not a key, but its extent still has to be reported so the caller
 * can step over it. Skipping rather than rejecting is the whole reason this is
 * a scanner and not a regex — `` `1px solid ${theme.border}` `` appears
 * hundreds of times in this codebase, and a scanner that gave up at the `${`
 * would mistake the closing backtick for an opening one and swallow the next
 * two hundred lines, silently losing every key inside them.
 *
 * A quoted literal may not cross a newline, which is the language's rule and
 * also what keeps a stray apostrophe — in JSX prose, in a comment this scanner
 * did not recognise — from doing the same thing. It fails at the line end, so
 * the damage stops there.
 */
function readLiteral(src: string, start: number): { value: string | null; end: number } | null {
  const quote = src[start];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let value: string | null = '';
  let i = start + 1;
  while (i < src.length) {
    const char = src[i];
    if (char === '\\') {
      const next = src[i + 1] ?? '';
      if (value !== null) value += next in ESCAPES ? ESCAPES[next] : next;
      i += 2;
      continue;
    }
    if (char === '\n' && quote !== '`') return null;
    if (quote === '`' && char === '$' && src[i + 1] === '{') {
      value = null;
      i = skipSubstitution(src, i + 1);
      continue;
    }
    if (char === quote) return { value, end: i + 1 };
    if (value !== null) value += char;
    i += 1;
  }
  return null;
}

/** Index just past the `{…}` of a template substitution, braces balanced. */
function skipSubstitution(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const char = src[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    } else if (char === "'" || char === '"' || char === '`') {
      const nested = readLiteral(src, i);
      if (nested) i = nested.end - 1;
    }
  }
  return src.length;
}

/** Index just past a comment starting at `i`, or `i` if none starts there. */
function skipComment(src: string, i: number): number {
  if (src[i] === '/' && src[i + 1] === '/') {
    const end = src.indexOf('\n', i);
    return end === -1 ? src.length : end;
  }
  if (src[i] === '/' && src[i + 1] === '*') {
    const end = src.indexOf('*/', i + 2);
    return end === -1 ? src.length : end + 2;
  }
  return i;
}

/** The span of the first argument: up to the comma or paren that closes it. */
function firstArgument(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const char = src[i];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) return src.slice(open, i);
      depth -= 1;
    } else if (char === ',' && depth === 0) return src.slice(open, i);
    else if (char === "'" || char === '"' || char === '`') {
      const literal = readLiteral(src, i);
      i = literal ? literal.end - 1 : i;
    }
  }
  return src.slice(open);
}

/**
 * The keys a first-argument expression can produce, or null when the scanner
 * cannot see them.
 *
 * Two shapes are readable. Adjacent literals joined by `+` are one key that
 * prettier wrapped across lines. Anything else containing literals is a ternary
 * picking between whole sentences — the codebase's stand-in for plurals — and
 * each branch is a key in its own right.
 */
function keysIn(argument: string): string[] | null {
  const literals: string[] = [];
  let concatenatedOnly = true;
  let i = 0;
  while (i < argument.length) {
    const char = argument[i];
    if (char === "'" || char === '"' || char === '`') {
      const literal = readLiteral(argument, i);
      if (!literal || literal.value === null) return null;
      literals.push(literal.value);
      i = literal.end;
      continue;
    }
    if (!/[\s+]/.test(char)) concatenatedOnly = false;
    i += 1;
  }
  if (literals.length === 0) return null;
  return concatenatedOnly ? [literals.join('')] : literals;
}

function scanCalls(): TrCall[] {
  const calls: TrCall[] = [];
  const pattern = /\b(?:tr|trParts)\s*\(/g;
  for (const file of sourceFiles()) {
    const src = readFileSync(file, 'utf8');
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(src))) {
      // A member call (`node.tr(`) and the declarations in `store/i18n.ts` are
      // not call sites.
      if (/[.\w$]/.test(src[match.index - 1] ?? '')) continue;
      if (src.slice(Math.max(0, match.index - 9), match.index) === 'function ') continue;
      const argument = firstArgument(src, match.index + match[0].length);
      // `tr()` written in prose inside a doc comment.
      if (argument.trim() === '') continue;
      calls.push({
        file: relative(SRC, file),
        line: src.slice(0, match.index).split('\n').length,
        keys: keysIn(argument),
      });
    }
  }
  return calls;
}

/**
 * Every string literal in `src/`, indexed by value, for the register checks.
 *
 * The catalogue module is excluded. Every key is a string literal *there* by
 * construction, so counting it would make "is this text written anywhere in the
 * app" answer yes for all 482 entries, and check 4 would pass on an empty UI.
 */
function literalIndex(): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  const catalogueModule = resolve(SRC, 'lib/i18n.ts');
  const record = (value: string, file: string): void => {
    const files = index.get(value) ?? new Set<string>();
    files.add(file);
    index.set(value, files);
  };
  for (const file of sourceFiles()) {
    if (file === catalogueModule) continue;
    const src = readFileSync(file, 'utf8');
    const name = relative(SRC, file);
    for (let i = 0; i < src.length; i += 1) {
      const afterComment = skipComment(src, i);
      if (afterComment !== i) {
        i = afterComment - 1;
        continue;
      }
      const literal = readLiteral(src, i);
      if (!literal) continue;
      i = literal.end - 1;
      if (literal.value === null) continue;
      record(literal.value, name);
      // A sentence too long for one line is written `'…' +\n  '…'`. Record the
      // joined text too, so the register can declare the key as the user reads
      // it rather than as prettier split it.
      let value = literal.value;
      let end = literal.end;
      for (;;) {
        let j = end;
        while (/\s/.test(src[j] ?? '')) j += 1;
        if (src[j] !== '+') break;
        j += 1;
        while (/\s/.test(src[j] ?? '')) j += 1;
        const next = readLiteral(src, j);
        if (!next || next.value === null) break;
        value += next.value;
        end = next.end;
        record(value, name);
      }
    }
  }
  return index;
}

const calls = scanCalls();
const literals = literalIndex();
const catalogue = catalogueFor('zh-TW');
const kept = new Set(KEPT_IN_ENGLISH);
const translated = (key: string): boolean => key in catalogue || kept.has(key);

/** The register flattened to one row per declared key. */
function registeredKeys(): { file: string; from: string; key: string }[] {
  return Object.entries(DYNAMIC_TR_SOURCES).flatMap(([file, source]) =>
    Object.entries(source.keys).flatMap(([from, keys]) => keys.map((key) => ({ file, from, key }))),
  );
}

describe('Traditional Chinese coverage', () => {
  it('translates every tr() call whose key is a literal', () => {
    const untranslated = calls
      .filter((call) => call.keys !== null)
      .flatMap((call) =>
        (call.keys ?? [])
          .filter((key) => !translated(key))
          .map((key) => `${call.file}:${call.line}  ${JSON.stringify(key)}`),
      );
    expect(
      untranslated,
      'Add a zh-TW entry in src/lib/i18n.ts, or add the key to KEPT_IN_ENGLISH with a reason:',
    ).toEqual([]);
  });

  it('keeps every tr() call with a computed key on the reviewed register', () => {
    const unregistered = calls
      .filter((call) => call.keys === null)
      .map((call) => `src/${call.file}`)
      .filter((file) => !(file in DYNAMIC_TR_SOURCES));
    expect(
      [...new Set(unregistered)],
      'A computed key hides from this gate. Add the file to DYNAMIC_TR_SOURCES, listing the keys it can produce:',
    ).toEqual([]);
  });

  it('registers no dynamic source that no longer has a computed key', () => {
    const withComputedKeys = new Set(
      calls.filter((call) => call.keys === null).map((call) => `src/${call.file}`),
    );
    const stale = Object.keys(DYNAMIC_TR_SOURCES).filter((file) => !withComputedKeys.has(file));
    expect(
      stale,
      'These files no longer compute a tr() key — drop them from the register:',
    ).toEqual([]);
  });

  it('translates every key a registered dynamic source can produce', () => {
    const untranslated = registeredKeys().flatMap(({ file, key }) =>
      translated(key) ? [] : [`${file}  ${JSON.stringify(key)}`],
    );
    expect(untranslated, 'A key reached through an expression still needs a zh-TW entry:').toEqual(
      [],
    );
  });

  it('keeps every registered key present in the module it is declared to come from', () => {
    const missing = registeredKeys().flatMap(({ file, from, key }) =>
      literals.get(key)?.has(relative('src', from))
        ? []
        : [`${file} declares ${JSON.stringify(key)} from ${from}`],
    );
    expect(missing, 'The register has gone stale against its source module:').toEqual([]);
  });

  it('leaves no sentence-length translation stranded outside tr()', () => {
    // A translated paragraph that no `tr()` reaches is one of two bugs: the JSX
    // was never wrapped, so the user reads English while a translation sits
    // right there; or the English was edited and orphaned its entry. Both are
    // invisible at runtime, because the fallback renders the English either way.
    const reachable = new Set([
      ...calls.flatMap((call) => call.keys ?? []),
      ...registeredKeys().map(({ key }) => key),
    ]);
    const stranded = Object.keys(catalogue)
      .filter((key) => key.length >= SENTENCE_LENGTH)
      .filter((key) => !reachable.has(key) && !literals.has(key));
    expect(
      stranded,
      'Translated, but nothing reads it. Wrap the JSX in tr(), or delete the entry:',
    ).toEqual([]);
  });
});
