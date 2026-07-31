// Secret redaction for the session transcript.
//
// Read this first, because the honest framing matters more than the rule list:
// **this cannot make a transcript safe to share.** It masks shapes, not
// meaning. A transcript is a recording of source code and instructions, and a
// secret with no shape has nothing to match on.
//
// What it does *not* catch, stated as narrowly as the code now allows:
//
//   * A secret written as prose or dictated in a sentence — "the staging login
//     is admin / correct horse battery". There is no delimiter, no keyword and
//     no prefix, so there is nothing to anchor on.
//   * Identifying context that is sensitive without being a credential:
//     internal hostnames, customer names, repository paths, ticket titles.
//   * Source code, which is most of what a transcript contains.
//   * A high-entropy string carrying no prefix and no adjacent label — a bare
//     40-character AWS secret access key sitting on its own line is byte-for-byte
//     a git object id or a base64 chunk. Labelled forms (`aws_secret_access_key=…`,
//     `"SecretAccessKey": "…"`) *are* caught; the naked string is not, and no
//     regex can separate it from the blob next to it.
//   * A credential shape that postdates this file. The rule list is finite and
//     vendors keep inventing prefixes.
//
// What it *does* guarantee, and this is the part that changed:
//
//   **When a rule matches, nothing that rule matched — and no tail hanging off
//   the end of it — survives into the written text.** A match is widened to the
//   end of the whitespace-or-quote-delimited value it landed in before the
//   marker is spliced in, so a password containing `@`, `!`, `.` or `%` cannot
//   be cut in half by the character class that found it. A PEM header is
//   widened through the entire key block, header line to `-----END …-----`
//   inclusive. The previous version stamped `[REDACTED:private-key]` over the
//   header and wrote the key body to disk underneath it, which is worse than
//   having no rule at all: the marker is an affirmative claim that the secret
//   was handled, so a human reading the transcript sees a mask and stops
//   looking.
//
// The rule set starts from `.gitleaks.toml`: the three project-specific rules
// verbatim, plus the highest-value patterns from the gitleaks default ruleset
// that config pulls in via `useDefault = true`, plus the vendor prefixes that
// matter most for a tool that shells out to `git` and `gh`. Gitleaks itself is
// deliberately NOT shelled out to — it is a process-level tool, and this runs
// on an append-only write path. A bounded regex set over short strings costs
// microseconds; spawning a process per event would cost milliseconds and a
// file descriptor.
//
// Every pattern here is linear-time by construction: no nested quantifiers, no
// alternation inside a repetition, every unbounded run of a character class
// followed by a literal that the class excludes. A transcript is
// attacker-influenced input (an agent prints what it likes), so a
// catastrophically backtracking regex would be a denial-of-service on the write
// path, not a cosmetic problem. `redact.test.ts` drives every rule — including
// any rule added after this comment — with 20,000 hostile characters.

/**
 * Widen a raw match to the whole span that must not survive.
 *
 * Given the text and the half-open range the pattern matched, return the new
 * end offset. Returning `end` unchanged is legal but almost always wrong: the
 * character class that found the value is also what stops it, and whatever the
 * class excluded is exactly the tail that would otherwise be written to disk.
 */
type SpanExtender = (text: string, start: number, end: number) => number;

/** One named shape. `pattern` must carry the `g` flag — see `redactSecrets`. */
export interface RedactionRule {
  readonly id: string;
  readonly pattern: RegExp;
  /** Defaults to `extendToValueEnd`. Only multi-line blocks need their own. */
  readonly extend?: SpanExtender;
}

export interface RedactionResult {
  /** The input with every match replaced by a marker. */
  readonly text: string;
  /** Ids of the rules that fired, in rule order. Empty when nothing matched. */
  readonly rules: readonly string[];
}

/**
 * The marker left behind when a rule fires.
 *
 * Shape chosen so that it is (a) obvious to a human reading the timeline,
 * (b) greppable as a single literal, (c) self-describing — it names the rule,
 * so you can tell "we masked something that looked like an Anthropic key" from
 * "we masked something that looked like a generic assignment", and (d) unable
 * to re-trigger a later rule in the same pass: the id is followed by `]`, never
 * by `=` or `:`, so the generic assignment rule cannot chain off it.
 */
export function redactionMarker(ruleId: string): string {
  return `[REDACTED:${ruleId}]`;
}

/**
 * Characters that end a value in every serialisation a transcript carries.
 *
 * ASCII whitespace and the three quote characters, and nothing else. The
 * temptation is to add `,`, `;`, `}` and `)` so the mask stops at "obvious"
 * punctuation — that temptation is the bug this module was built to remove. A
 * password may legitimately contain any of them; a password may not contain an
 * unescaped quote or a raw newline. Over-consuming a trailing `}` costs a
 * bracket in a local log. Under-consuming costs a credential on disk.
 *
 * Unicode spaces are deliberately absent. `\s` in a pattern stops at one, so a
 * value containing U+00A0 would otherwise be cut there and the tail written
 * out; treating it as an ordinary character means the scan runs on to real
 * whitespace instead.
 */
const VALUE_BREAK_CHARS = new Set([' ', '\t', '\n', '\r', '\f', '\v', '\u00a0', '"', "'", '`']);

/** Is the quote at `index` escaped — i.e. inside the value rather than ending it? */
function isEscapedQuote(text: string, index: number): boolean {
  let backslashes = 0;
  let cursor = index - 1;
  while (cursor >= 0 && text[cursor] === '\\') {
    backslashes += 1;
    cursor -= 1;
  }
  return backslashes % 2 === 1;
}

/**
 * Widen to the end of the whitespace-or-quote-delimited value. The default.
 *
 * A `\"` inside a JSON string is part of the value, not the end of it, and an
 * agent printing a JSON blob prints exactly that. Stopping there would leave
 * the rest of the credential on disk under a marker claiming it was handled.
 */
function extendToValueEnd(text: string, _start: number, end: number): number {
  let cursor = end;
  while (cursor < text.length) {
    const ch = text[cursor];
    if (VALUE_BREAK_CHARS.has(ch)) {
      const isNewline = ch === '\n' || ch === '\r';
      if (isNewline || !isEscapedQuote(text, cursor)) break;
    }
    cursor += 1;
  }
  return cursor;
}

/** Offset of the `\n` at or after `from`, or the end of the text. */
function endOfLine(text: string, from: number): number {
  const nl = text.indexOf('\n', from);
  return nl === -1 ? text.length : nl;
}

/**
 * A line that may belong to a PEM block: base64 body, an RFC 1421 header
 * (`Proc-Type: 4,ENCRYPTED`), a blank separator, or the `-----END …-----` line.
 * Deliberately permissive — key material *is* base64, so any body line matches.
 */
const PEM_BLOCK_LINE = /^[A-Za-z0-9+/=:,.\- ]*$/;

/**
 * Widen a `-----BEGIN … PRIVATE KEY-----` header through the whole block.
 *
 * Consumes the rest of the header line, then every following line that could be
 * part of the block, stopping *after* the `-----END …-----` line or *before*
 * the first line that plainly is not key material. A truncated key — the header
 * arrived, the transcript hit its 4096-character detail cap mid-body — has no
 * END line, and the scan correctly runs to the end of the text: every one of
 * those base64 lines is key material.
 */
function extendThroughPemBlock(text: string, _start: number, end: number): number {
  let cursor = endOfLine(text, end);
  while (cursor < text.length) {
    const lineStart = cursor + 1;
    const lineEnd = endOfLine(text, lineStart);
    const line = text.slice(lineStart, lineEnd).replace(/\r$/, '');
    if (!PEM_BLOCK_LINE.test(line)) return cursor;
    cursor = lineEnd;
    if (line.includes('-----END ')) return cursor;
  }
  return cursor;
}

/**
 * Ordered most-specific first. Order is load-bearing: the generic assignment
 * rule at the end would otherwise swallow a token that a named rule could have
 * identified precisely, and a precise marker is more useful than a vague one.
 */
export const REDACTION_RULES: readonly RedactionRule[] = [
  // A PEM block. The header is what the pattern finds; `extendThroughPemBlock`
  // is what makes the body go away. Header alternation is a flat bounded class,
  // so `RSA`, `EC`, `DSA`, `OPENSSH`, `PGP`, `ENCRYPTED` and a bare
  // `-----BEGIN PRIVATE KEY-----` all land in the same rule.
  {
    id: 'private-key',
    pattern: /-----BEGIN [A-Z0-9 ]{0,24}PRIVATE KEY(?: BLOCK)?-----/g,
    extend: extendThroughPemBlock,
  },
  // --- The three rules defined in .gitleaks.toml, carried over verbatim ---
  {
    id: 'parallel-code-mcp-token',
    pattern: /PARALLEL_CODE_MCP_TOKEN\s*[=:]\s*['"]?[A-Za-z0-9+/_-]{20,}['"]?/g,
  },
  {
    id: 'anthropic-api-key',
    pattern: /sk-ant-[A-Za-z0-9\-_]{40,}/g,
  },
  {
    id: 'bearer-token-in-url',
    pattern: /[?&]token=[A-Za-z0-9+/\-_]{20,}/g,
  },
  // --- Highest-value members of the gitleaks default ruleset ---
  {
    id: 'openai-api-key',
    pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g,
  },
  // Both GitHub shapes. `github_pat_` is the fine-grained format and the single
  // most likely credential to appear in the transcript of a tool that shells
  // out to `git` and `gh`; the old `gh[pousr]_` rule did not cover it.
  {
    id: 'github-token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
  },
  {
    id: 'gitlab-token',
    pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: 'slack-token',
    pattern: /\bxox[baprse]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: 'slack-webhook-url',
    pattern: /\bhttps:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,}/g,
  },
  {
    id: 'aws-access-key-id',
    pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g,
  },
  {
    id: 'azure-storage-key',
    pattern: /AccountKey\s*=\s*[A-Za-z0-9+/=]{40,}/gi,
  },
  {
    id: 'google-api-key',
    pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g,
  },
  {
    id: 'google-oauth-client-secret',
    pattern: /\bGOCSPX-[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: 'stripe-secret-key',
    pattern: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{20,}/g,
  },
  {
    id: 'sendgrid-api-key',
    pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
  },
  {
    id: 'age-secret-key',
    pattern: /\bAGE-SECRET-KEY-1[0-9A-Za-z]{20,}/g,
  },
  {
    id: 'atlassian-api-token',
    pattern: /\bATATT3x[A-Za-z0-9_=.-]{40,}/g,
  },
  {
    id: 'digitalocean-token',
    pattern: /\bdop_v1_[a-f0-9]{60,}/g,
  },
  {
    id: 'doppler-token',
    pattern: /\bdp\.(?:pt|st|ct|sa|scim|audit)\.[A-Za-z0-9_-]{40,}/g,
  },
  {
    id: 'shopify-access-token',
    pattern: /\bshp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}/g,
  },
  {
    id: 'telegram-bot-token',
    pattern: /\b[0-9]{8,12}:AA[A-Za-z0-9_-]{30,}/g,
  },
  {
    id: 'pypi-token',
    pattern: /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/g,
  },
  {
    id: 'linear-api-key',
    pattern: /\blin_api_[A-Za-z0-9]{32,}/g,
  },
  {
    id: 'mailgun-api-key',
    pattern: /\bkey-[a-f0-9]{32}\b/g,
  },
  {
    id: 'databricks-token',
    pattern: /\bdapi[a-f0-9]{32}/g,
  },
  {
    id: 'terraform-cloud-token',
    pattern: /\b[A-Za-z0-9]{10,20}\.atlasv1\.[A-Za-z0-9_-]{40,}/g,
  },
  {
    id: 'huggingface-token',
    pattern: /\bhf_[A-Za-z0-9]{30,}\b/g,
  },
  {
    id: 'npm-token',
    pattern: /\bnpm_[A-Za-z0-9]{36}\b/g,
  },
  {
    id: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  // `Authorization: Bearer …` / `Basic …`. An agent that pastes a curl command
  // pastes this shape, and the value carries no vendor prefix to key on.
  {
    id: 'authorization-header',
    pattern: /\bAuthorization\s*:\s*(?:Bearer|Basic|Token|ApiKey)\s+[A-Za-z0-9+/=._~-]{16,}/gi,
  },
  // A credential in the userinfo of a URL: `postgres://user:pass@host`,
  // `redis://:pass@host`, `https://alice:hunter2@git.internal/repo.git`. Both
  // runs are bounded and each is terminated by a literal its class excludes, so
  // the match is deterministic.
  {
    id: 'url-credentials',
    pattern: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@/'"]{0,64}:[^\s@/'"]{1,128}@/gi,
  },
  // A secret in a URL *path* segment rather than a query parameter — password
  // reset links, CI artifact links, the `?token=` rule's blind spot.
  {
    id: 'token-in-url-path',
    pattern: /\/(?:token|access_token|api_key|apikey|secret|auth_token)\/[A-Za-z0-9+/._~-]{20,}/gi,
  },
  // The catch-all: `SOMETHING_SECRET = "long-opaque-value"`. Deliberately last,
  // deliberately the noisiest. It is the rule that earns its keep on agent
  // output, where credentials arrive as shell assignments far more often than
  // as recognisable vendor prefixes. False positives cost a masked string in a
  // local log; false negatives cost a leaked credential on disk.
  // The bounded prefix is not decoration: the shapes that matter in the wild are
  // `DB_PASSWORD=…` and `GITHUB_TOKEN=…`, where the keyword is preceded by a
  // word character, so a leading `\b` would never fire. It is bounded (not `*`)
  // to keep the match linear on hostile input.
  // The `['"]?` before the separator is what makes the JSON shape work —
  // `"SecretAccessKey": "…"` puts a quote between the keyword and the colon,
  // and without it every JSON-serialised credential walked straight through.
  // The value is three flat alternatives rather than one character class: a
  // quoted value may contain spaces, an unquoted one runs to the next
  // whitespace. The old class `[A-Za-z0-9/+=_-]{16,}` stopped at the first `@`
  // or `.` and wrote the rest of the password to disk.
  {
    id: 'generic-assignment',
    pattern:
      /[A-Za-z0-9_.-]{0,32}(?:api[_-]?key|apikey|secret|passwd|password|token|access[_-]?key|auth)['"]?\s*[=:]\s*(?:'[^'\r\n]{8,}'|"[^"\r\n]{8,}"|[^\s'"]{16,})/gi,
  },
];

interface RedactionSpan {
  readonly start: number;
  readonly end: number;
  /** Index into `REDACTION_RULES`. The lowest index in a merge names the marker. */
  readonly ruleIndex: number;
}

/** Is `[start, end)` already inside one of the merged, sorted `covered` ranges? */
function isCovered(covered: readonly RedactionSpan[], start: number, end: number): boolean {
  for (const span of covered) {
    if (span.start > start) return false;
    if (end <= span.end) return true;
  }
  return false;
}

/** Sort by start, then fold overlapping or touching spans together. */
function mergeSpans(spans: readonly RedactionSpan[]): RedactionSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: RedactionSpan[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span.start <= last.end) {
      merged[merged.length - 1] = {
        start: last.start,
        end: Math.max(last.end, span.end),
        ruleIndex: Math.min(last.ruleIndex, span.ruleIndex),
      };
    } else {
      merged.push(span);
    }
  }
  return merged;
}

/**
 * Mask every known secret shape in `text`.
 *
 * Two properties are worth stating because they are the ones that broke before:
 *
 * 1. **Nothing a rule matched survives.** Matches are collected as spans over
 *    the *original* text, each span is widened past the end of its value, the
 *    spans are merged, and the markers are spliced in one pass. Widening means
 *    a rule can only ever remove more than it matched, never less — so "rule
 *    fired, marker stamped, tail written to disk" is not a state this function
 *    can reach. When two rules overlap the union is removed and the more
 *    specific rule (the lower index) names the marker.
 *
 * 2. **No `RegExp` state leaks between calls.** `matchAll` is specified to run
 *    against a *clone* of the regex, and this function never calls `.test()` or
 *    `.exec()` on the shared `g` patterns. (A `g` regex reused with `.test()`
 *    carries `lastIndex` and silently skips every other match — a classic way
 *    to leak exactly half your secrets.)
 *
 * A rule is reported in `rules` only when it matched something no earlier rule
 * had already covered, which keeps the marker list as specific as the old
 * sequential pass made it.
 */
export function redactSecrets(text: string): RedactionResult {
  if (typeof text !== 'string' || text.length === 0) {
    return { text: typeof text === 'string' ? text : '', rules: [] };
  }

  const spans: RedactionSpan[] = [];
  const fired: string[] = [];
  let covered: RedactionSpan[] = [];

  for (let ruleIndex = 0; ruleIndex < REDACTION_RULES.length; ruleIndex += 1) {
    const rule = REDACTION_RULES[ruleIndex];
    const extend = rule.extend ?? extendToValueEnd;
    const found: RedactionSpan[] = [];
    let ownEnd = -1;
    let novel = false;

    for (const match of text.matchAll(rule.pattern)) {
      const start = match.index;
      if (typeof start !== 'number' || match[0].length === 0) continue;
      if (!novel && !isCovered(covered, start, start + match[0].length)) novel = true;
      // A match inside a span this same rule already widened over adds nothing.
      if (start < ownEnd) continue;
      const end = Math.max(start + match[0].length, extend(text, start, start + match[0].length));
      ownEnd = end;
      found.push({ start, end, ruleIndex });
    }

    if (found.length === 0) continue;
    if (novel) fired.push(rule.id);
    spans.push(...found);
    covered = mergeSpans(spans);
  }

  if (spans.length === 0) return { text, rules: [] };

  let out = '';
  let cursor = 0;
  for (const span of covered) {
    out += text.slice(cursor, span.start) + redactionMarker(REDACTION_RULES[span.ruleIndex].id);
    cursor = span.end;
  }
  return { text: out + text.slice(cursor), rules: fired };
}
