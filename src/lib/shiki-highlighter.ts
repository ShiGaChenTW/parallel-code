import type { HighlighterCore, LanguageRegistration, SpecialLanguage } from 'shiki';
import { store } from '../store/store';

/**
 * WHY THIS FILE IMPORTS `shiki/core` AND NOT `shiki`
 *
 * `import('shiki')` is the full bundle: a registry of all 346 languages, each
 * entry a `() => import(...)`. rolldown honours every one of them, so `dist`
 * carried 236 grammar chunks totalling 8,064,047 B — 52.4% of the whole build —
 * of which 210 files and 5,957,110 B could never be loaded at runtime. Nothing
 * routes to them: `detectLang` only ever returns a language in this file's maps,
 * and `highlightLines` falls back to plaintext for anything not loaded.
 *
 * `shiki/core` carries no registry, so the grammars in `dist` are exactly the
 * ones named in `LANG_LOADERS` below.
 *
 * `@shikijs/langs` and `@shikijs/themes` are declared in package.json even
 * though they already arrive as `shiki`'s own dependencies at the identical
 * pinned version (4.0.2). Nothing new is installed by that — `npm install
 * --package-lock-only` added two declaration lines and resolved no new package.
 * They are declared because importing a package you did not declare is a
 * phantom dependency that works only by hoisting luck, and because a future
 * `shiki` bump must not be able to move these two out from under us silently.
 */

/** The two themes this app ships. */
type ThemeName = 'github-dark' | 'github-light';

/** Pick the shiki theme that pairs with the active look preset. */
function activeTheme(): ThemeName {
  return store.themePreset === 'islands-light' ? 'github-light' : 'github-dark';
}

type LangLoader = () => Promise<{ default: LanguageRegistration[] }>;

/**
 * The grammar for every language this app highlights, one explicit `import()`
 * each.
 *
 * Explicit and literal on purpose. The obvious compression —
 * ``(lang) => import(`@shikijs/langs/${lang}`)`` — type-checks, builds, and
 * makes `dist` about 2 MB *smaller* than the correct version, because rolldown
 * cannot resolve a template literal and silently emits no grammar chunks at
 * all. The app then highlights nothing at all. A smaller bundle is not evidence
 * of a working one; 28 specifiers a bundler can follow are.
 */
const LANG_LOADERS = {
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  rust: () => import('@shikijs/langs/rust'),
  json: () => import('@shikijs/langs/json'),
  css: () => import('@shikijs/langs/css'),
  scss: () => import('@shikijs/langs/scss'),
  less: () => import('@shikijs/langs/less'),
  html: () => import('@shikijs/langs/html'),
  xml: () => import('@shikijs/langs/xml'),
  markdown: () => import('@shikijs/langs/markdown'),
  python: () => import('@shikijs/langs/python'),
  ruby: () => import('@shikijs/langs/ruby'),
  go: () => import('@shikijs/langs/go'),
  java: () => import('@shikijs/langs/java'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  swift: () => import('@shikijs/langs/swift'),
  sql: () => import('@shikijs/langs/sql'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  yaml: () => import('@shikijs/langs/yaml'),
  toml: () => import('@shikijs/langs/toml'),
  ini: () => import('@shikijs/langs/ini'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  lua: () => import('@shikijs/langs/lua'),
  cpp: () => import('@shikijs/langs/cpp'),
  c: () => import('@shikijs/langs/c'),
  makefile: () => import('@shikijs/langs/makefile'),
} satisfies Record<string, LangLoader>;

/**
 * A language this app ships a grammar for.
 *
 * Derived from `LANG_LOADERS` rather than declared next to it, so the two
 * places that would otherwise need hand-syncing cannot drift: map an extension
 * to a language with no loader and `tsc` rejects it, instead of the file
 * quietly rendering as plaintext at runtime.
 */
type PreloadedLang = keyof typeof LANG_LOADERS;

/** Map file extensions to Shiki language identifiers. */
const EXT_TO_LANG: Record<string, PreloadedLang> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  rs: 'rust',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  xml: 'xml',
  svg: 'xml',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  sql: 'sql',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  dockerfile: 'dockerfile',
  lua: 'lua',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  hpp: 'cpp',
};

/** Basenames that map to a language regardless of extension. */
const BASENAME_TO_LANG: Record<string, PreloadedLang> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
};

/**
 * Deduplicated set of languages to pre-load.
 *
 * The same 28 languages as before this file moved to `shiki/core`. The set is
 * now read off the loader map rather than off the extension maps, because the
 * loader map is what decides what `dist` contains.
 */
export const PRELOAD_LANGS = Object.keys(LANG_LOADERS) as PreloadedLang[];

let highlighterPromise: Promise<HighlighterCore> | undefined;

/** Lazy singleton — creates the highlighter on first call. */
function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki/core').then(async (core) => {
      const { createOnigurumaEngine } = await import('shiki/engine/oniguruma');
      return core.createHighlighterCore({
        themes: [import('@shikijs/themes/github-dark'), import('@shikijs/themes/github-light')],
        langs: Object.values(LANG_LOADERS),
        // The engine the full bundle already defaulted to: `shiki/dist/bundle-full.mjs`
        // resolves `engine` to exactly this expression, so grammar behaviour is
        // unchanged. `shiki/wasm` is the oniguruma regex engine — it was never
        // one of the wasted grammar chunks and is still required.
        engine: createOnigurumaEngine(import('shiki/wasm')),
      });
    });
  }
  return highlighterPromise;
}

/**
 * Detect a Shiki language identifier from a file path.
 * Checks special basenames first, then file extension. Falls back to 'plaintext'.
 */
export function detectLang(filePath: string): string {
  const basename = filePath.split('/').pop()?.toLowerCase() ?? '';
  const match = BASENAME_TO_LANG[basename];
  if (match) return match;

  const ext = basename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANG[ext] ?? 'plaintext';
}

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => ESCAPE_MAP[ch] ?? ch);
}

/**
 * Highlight `code` with Shiki and return one HTML string per line.
 * Each token is wrapped in `<span style="color:…">…</span>`.
 * Falls back to 'plaintext' when the requested language is not loaded.
 */
export async function highlightLines(code: string, lang: string): Promise<string[]> {
  const hl = await getHighlighter();

  // Fall back to plaintext if the language isn't loaded.
  //
  // `getLoadedLanguages()` returns 56 names, not the 28 requested: shiki also
  // registers the grammars those 28 embed — markdown's code fences, html's
  // inline js and css — plus their alias names. The full bundle did the same,
  // and it is what keeps a ```ts fence inside a markdown note highlighted.
  const loadedLangs = hl.getLoadedLanguages();
  const effectiveLang: string | SpecialLanguage =
    loadedLangs.includes(lang) || lang === 'plaintext' ? lang : 'plaintext';

  const { tokens } = hl.codeToTokens(code, {
    lang: effectiveLang,
    theme: activeTheme(),
  });

  return tokens.map((line) =>
    line
      .map((token) => {
        const escaped = escapeHtml(token.content);
        if (token.color) {
          return `<span style="color:${token.color}">${escaped}</span>`;
        }
        return escaped;
      })
      .join(''),
  );
}
