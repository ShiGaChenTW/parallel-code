import { describe, expect, it } from 'vitest';

import { REDACTION_RULES, redactSecrets, redactionMarker } from './redact.js';

// Fixture secrets are synthetic — repeated characters, never a real key shape
// anyone could have issued. `.gitleaks.toml` allowlists `*.test.ts` globally for
// exactly this reason.
const FAKE = {
  anthropic: 'sk-ant-' + 'a'.repeat(64),
  openai: 'sk-proj-' + 'b'.repeat(48),
  github: 'ghp_' + 'c'.repeat(36),
  gitlab: 'glpat-' + 'd'.repeat(20),
  slack: 'xoxb-' + '1'.repeat(12),
  aws: 'AKIA' + 'Q'.repeat(16),
  google: 'AIza' + 'e'.repeat(35),
  hf: 'hf_' + 'f'.repeat(30),
  npm: 'npm_' + 'g'.repeat(36),
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r',
};

describe('the marker left behind', () => {
  it('names the rule that fired, so the mask is self-describing', () => {
    expect(redactionMarker('anthropic-api-key')).toBe('[REDACTED:anthropic-api-key]');
  });

  it('cannot re-trigger the generic assignment rule on a second pass', () => {
    // The marker ends in `]`, never `=` or `:`, so `token]` is not an
    // assignment. Feeding a marker back through must be a fixed point.
    for (const rule of REDACTION_RULES) {
      const marker = redactionMarker(rule.id);
      expect(redactSecrets(marker).text).toBe(marker);
    }
  });
});

describe('what it catches', () => {
  it.each([
    ['anthropic-api-key', FAKE.anthropic],
    ['openai-api-key', FAKE.openai],
    ['github-token', FAKE.github],
    ['gitlab-token', FAKE.gitlab],
    ['slack-token', FAKE.slack],
    ['aws-access-key-id', FAKE.aws],
    ['google-api-key', FAKE.google],
    ['huggingface-token', FAKE.hf],
    ['npm-token', FAKE.npm],
    ['jwt', FAKE.jwt],
  ])('masks a %s', (ruleId, secret) => {
    const result = redactSecrets(`the value is ${secret} ok`);
    expect(result.text).not.toContain(secret);
    expect(result.rules).toContain(ruleId);
  });

  it('masks the project-specific MCP token rule from .gitleaks.toml', () => {
    const secret = 'PARALLEL_CODE_MCP_TOKEN="' + 'z'.repeat(32) + '"';
    const result = redactSecrets(`env ${secret}`);
    expect(result.text).not.toContain('z'.repeat(32));
    expect(result.rules).toContain('parallel-code-mcp-token');
  });

  it('masks a bearer token in a URL — the Remote Access footgun', () => {
    const url = 'http://192.168.1.4:7777/?token=' + 'h'.repeat(32);
    const result = redactSecrets(`open ${url}`);
    expect(result.text).not.toContain('h'.repeat(32));
    expect(result.rules).toContain('bearer-token-in-url');
  });

  it('masks a PEM private key header, so the block that follows is flagged', () => {
    const result = redactSecrets('-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n');
    expect(result.rules).toContain('private-key');
    expect(result.text).not.toContain('BEGIN OPENSSH PRIVATE KEY');
  });

  it('masks a generic shell assignment, the shape agent output actually produces', () => {
    const result = redactSecrets('export DB_PASSWORD=hunter2hunter2hunter2');
    expect(result.text).not.toContain('hunter2hunter2hunter2');
    expect(result.rules).toContain('generic-assignment');
  });

  it('masks every occurrence, not just the first', () => {
    const result = redactSecrets(`${FAKE.github} then ${FAKE.github.replace(/c/g, 'k')}`);
    expect(result.text).not.toContain('ghp_');
  });

  it('is not stateful across calls — the classic global-regex half-miss', () => {
    // A `g` regex reused with .test()/.exec() carries lastIndex and skips every
    // other match. Calling twice with identical input must give identical output.
    const first = redactSecrets(`a ${FAKE.github} b`);
    const second = redactSecrets(`a ${FAKE.github} b`);
    expect(second.text).toBe(first.text);
    expect(second.rules).toEqual(first.rules);
  });

  it('prefers the specific rule over the generic one', () => {
    // sk-ant- runs before the broader sk- rule, so the marker names Anthropic.
    expect(redactSecrets(FAKE.anthropic).text).toBe('[REDACTED:anthropic-api-key]');
  });
});

describe('what it does not catch — stated plainly, not hidden', () => {
  // These assertions exist so the limitation is a documented, tested fact
  // rather than a hopeful claim in a comment. A transcript IS source code and
  // instructions; the shapeless secrets below pass straight through, and
  // PRIVACY.md says so.
  it('does not catch a password written as prose', () => {
    const text = 'the staging login is admin and the password is correct horse battery';
    expect(redactSecrets(text).rules).toEqual([]);
  });

  it('does not catch an internal hostname or a customer name', () => {
    expect(redactSecrets('deploy to payments-prod-3.internal for Acme Corp').rules).toEqual([]);
  });

  it('does not catch a short or unprefixed credential', () => {
    expect(redactSecrets('pin 4021').rules).toEqual([]);
  });

  it('does not catch source code, which is most of what a transcript contains', () => {
    expect(redactSecrets('function signToken(u) { return hmac(u, SECRET_SALT); }').rules).toEqual(
      [],
    );
  });
});

describe('cost on the write path', () => {
  it('leaves ordinary text untouched and allocates no rule list', () => {
    const result = redactSecrets('implemented the JSONL writer and its retention pass');
    expect(result.text).toBe('implemented the JSONL writer and its retention pass');
    expect(result.rules).toEqual([]);
  });

  it('handles empty and non-string input without throwing', () => {
    expect(redactSecrets('').text).toBe('');
    expect(redactSecrets(undefined as unknown as string).text).toBe('');
  });

  it('stays linear on adversarial input — an agent controls what is printed', () => {
    // Every pattern is quantifier-flat by construction. A catastrophically
    // backtracking rule would hang the append path, so this is a guard rail,
    // not a benchmark: it fails loudly if someone adds a nested quantifier.
    const hostile = 'sk-ant-' + 'a'.repeat(20_000) + '!';
    const started = Date.now();
    redactSecrets(hostile);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('runs every rule over a realistic event in well under a millisecond of work', () => {
    const sample =
      'implementing: wired retention into TranscriptStore.append (src/…/transcript.ts)';
    const started = Date.now();
    for (let i = 0; i < 2000; i++) redactSecrets(sample);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('the rule set', () => {
  it('has unique ids', () => {
    const ids = REDACTION_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares every pattern global, or replace would mask only the first hit', () => {
    for (const rule of REDACTION_RULES) {
      expect(rule.pattern.flags, `${rule.id} is missing the g flag`).toContain('g');
    }
  });

  it('keeps the generic catch-all last so specific rules win', () => {
    expect(REDACTION_RULES[REDACTION_RULES.length - 1].id).toBe('generic-assignment');
  });
});
