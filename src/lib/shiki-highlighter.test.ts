import { describe, it, expect } from 'vitest';
import { detectLang, PRELOAD_LANGS } from './shiki-highlighter';

/**
 * The set of languages the highlighter bundles.
 *
 * Pinned as a literal rather than derived, because this list is now the thing
 * that decides how many grammar chunks land in `dist`. Under the old full-bundle
 * import, `dist` carried all 346 shiki languages (236 chunks, 8,064,047 B) and
 * adding one more cost nothing visible; now every entry here is a chunk someone
 * chose to ship. A diff on this array is the review moment for that choice.
 */
const EXPECTED_PRELOAD_LANGS = [
  'c',
  'cpp',
  'css',
  'dockerfile',
  'go',
  'html',
  'ini',
  'java',
  'javascript',
  'json',
  'jsx',
  'kotlin',
  'less',
  'lua',
  'makefile',
  'markdown',
  'python',
  'ruby',
  'rust',
  'scss',
  'shellscript',
  'sql',
  'swift',
  'toml',
  'tsx',
  'typescript',
  'xml',
  'yaml',
];

/**
 * One real path per preloaded language.
 *
 * Doubles as the reachability check: a language with a loader but no route
 * through `detectLang` is a grammar chunk shipped for nothing, and the type
 * system cannot catch that direction (it only catches the reverse — an
 * extension mapped to a language with no loader).
 */
const PATH_TO_LANG: Record<string, string> = {
  'src/a.ts': 'typescript',
  'src/a.tsx': 'tsx',
  'src/a.js': 'javascript',
  'src/a.jsx': 'jsx',
  'src/a.rs': 'rust',
  'src/a.json': 'json',
  'src/a.css': 'css',
  'src/a.scss': 'scss',
  'src/a.less': 'less',
  'src/a.html': 'html',
  'src/a.xml': 'xml',
  'src/a.svg': 'xml',
  'src/a.md': 'markdown',
  'src/a.py': 'python',
  'src/a.rb': 'ruby',
  'src/a.go': 'go',
  'src/a.java': 'java',
  'src/a.kt': 'kotlin',
  'src/a.swift': 'swift',
  'src/a.sql': 'sql',
  'src/a.sh': 'shellscript',
  'src/a.bash': 'shellscript',
  'src/a.zsh': 'shellscript',
  'src/a.yaml': 'yaml',
  'src/a.yml': 'yaml',
  'src/a.toml': 'toml',
  'src/a.ini': 'ini',
  'src/a.lua': 'lua',
  'src/a.cpp': 'cpp',
  'src/a.hpp': 'cpp',
  'src/a.c': 'c',
  'src/a.h': 'c',
  Dockerfile: 'dockerfile',
  Makefile: 'makefile',
};

describe('PRELOAD_LANGS', () => {
  it('is exactly the set of languages this app ships grammars for', () => {
    expect([...PRELOAD_LANGS].sort()).toEqual(EXPECTED_PRELOAD_LANGS);
  });

  it('has no duplicates', () => {
    expect(new Set(PRELOAD_LANGS).size).toBe(PRELOAD_LANGS.length);
  });

  it('ships no grammar that no file path can reach', () => {
    const reachable = new Set(Object.values(PATH_TO_LANG));
    const unreachable = PRELOAD_LANGS.filter((lang) => !reachable.has(lang));
    expect(unreachable).toEqual([]);
  });
});

describe('detectLang', () => {
  it.each(Object.entries(PATH_TO_LANG))('maps %s to %s', (path, lang) => {
    expect(detectLang(path)).toBe(lang);
  });

  it('resolves every language it returns to one this app preloads', () => {
    for (const lang of Object.values(PATH_TO_LANG)) {
      expect(PRELOAD_LANGS).toContain(lang);
    }
  });

  it('falls back to plaintext for an unmapped extension', () => {
    // `emacs-lisp` is one of the 210 grammars the old full bundle shipped and
    // never loaded; nothing should route to it now that it is not in `dist`.
    expect(detectLang('src/a.el')).toBe('plaintext');
    expect(detectLang('src/a.wolfram')).toBe('plaintext');
  });

  it('falls back to plaintext for a file with no extension', () => {
    expect(detectLang('LICENSE')).toBe('plaintext');
  });

  it('prefers a known basename over the extension', () => {
    expect(detectLang('build/Dockerfile')).toBe('dockerfile');
    expect(detectLang('build/Makefile')).toBe('makefile');
  });

  it('is case-insensitive for both basenames and extensions', () => {
    expect(detectLang('src/A.TS')).toBe('typescript');
    expect(detectLang('DOCKERFILE')).toBe('dockerfile');
  });
});
