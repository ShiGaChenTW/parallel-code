// Secret redaction for the session transcript.
//
// Read this first, because the honest framing matters more than the rule list:
// **this cannot make a transcript safe to share.** A transcript is a recording
// of source code and instructions. A password typed as prose, an internal
// hostname, a customer name in a commit message, a private key pasted without
// its PEM header — none of those have a shape, and none of them are caught
// here. Anything that claims otherwise is lying to you.
//
// What this module does is narrower and still worth doing: it masks the known
// *shapes* of credentials before anything reaches disk, so the common accident
// — an API key echoed into a step summary, an MCP token in a URL — does not
// become a file sitting in your application data directory. It is a seatbelt,
// not a vault.
//
// The rule set is borrowed from `.gitleaks.toml`: the three project-specific
// rules verbatim, plus the highest-value patterns from the gitleaks default
// ruleset that config pulls in via `useDefault = true`. Gitleaks itself is
// deliberately NOT shelled out to — it is a process-level tool, and this runs
// on an append-only write path. A bounded regex set over short strings costs
// microseconds; spawning a process per event would cost milliseconds and a
// file descriptor.
//
// Every pattern here is linear-time by construction: no nested quantifiers, no
// alternation inside a repetition. A transcript is attacker-influenced input
// (an agent prints what it likes), so a catastrophically backtracking regex
// would be a denial-of-service on the write path, not a cosmetic problem.

/** One named shape. `pattern` must carry the `g` flag — see `redactSecrets`. */
export interface RedactionRule {
  readonly id: string;
  readonly pattern: RegExp;
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
 * Ordered most-specific first. Order is load-bearing: the generic assignment
 * rule at the end would otherwise swallow a token that a named rule could have
 * identified precisely, and a precise marker is more useful than a vague one.
 */
export const REDACTION_RULES: readonly RedactionRule[] = [
  // A PEM block header. The body is not matched here — the header alone is
  // enough to know the following lines must not be written.
  {
    id: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
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
  {
    id: 'github-token',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
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
    id: 'aws-access-key-id',
    pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g,
  },
  {
    id: 'google-api-key',
    pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g,
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
  // The catch-all: `SOMETHING_SECRET = "long-opaque-value"`. Deliberately last,
  // deliberately the noisiest. It is the rule that earns its keep on agent
  // output, where credentials arrive as shell assignments far more often than
  // as recognisable vendor prefixes. False positives cost a masked string in a
  // local log; false negatives cost a leaked credential on disk.
  // The bounded prefix is not decoration: the shapes that matter in the wild are
  // `DB_PASSWORD=…` and `GITHUB_TOKEN=…`, where the keyword is preceded by a
  // word character, so a leading `\b` would never fire. It is bounded (not `*`)
  // to keep the match linear on hostile input.
  {
    id: 'generic-assignment',
    pattern:
      /[A-Za-z0-9_.-]{0,32}(?:api[_-]?key|apikey|secret|passwd|password|token|access[_-]?key|auth)\s*[=:]\s*['"]?[A-Za-z0-9/+=_-]{16,}['"]?/gi,
  },
];

/**
 * Mask every known secret shape in `text`.
 *
 * Uses only `String.replace`, never `RegExp.test`/`exec`, so the shared `g`
 * regexes above never carry a `lastIndex` between calls. (A `g` regex reused
 * with `.test()` is stateful and would silently skip every other match — a
 * classic way to leak exactly half your secrets.)
 */
export function redactSecrets(text: string): RedactionResult {
  if (typeof text !== 'string' || text.length === 0) {
    return { text: typeof text === 'string' ? text : '', rules: [] };
  }
  let out = text;
  const fired: string[] = [];
  for (const rule of REDACTION_RULES) {
    let hit = false;
    out = out.replace(rule.pattern, () => {
      hit = true;
      return redactionMarker(rule.id);
    });
    if (hit) fired.push(rule.id);
  }
  return { text: out, rules: fired };
}
