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

const rep = (n: number, c: string): string => c.repeat(n);

const PEM_RSA_BODY = [
  'MIIEowIBAAKCAQEAvBpXk9' + rep(30, 'K'),
  'QIDAQABAoIBAQCsecondli' + rep(30, 'L'),
].join('\n');

const PEM_ENC_BODY = [
  'MIIFDjBABgkqhkiG9w0BBQ' + rep(30, 'M'),
  'wYtY2VydGlmaWNhdGUgYmx' + rep(30, 'N'),
].join('\n');

/**
 * The corpus this wave was commissioned over.
 *
 * Every row names the credential material in `secret` and embeds it in a line
 * of plausible agent output in `input`. `secret` is the material and nothing
 * else — not the surrounding URL host, not the `Authorization` keyword — so an
 * assertion that `secret` is gone is an assertion about the credential, not
 * about the punctuation around it.
 *
 * On `main` thirty of these leaked: twenty-seven were never matched at all, and
 * three matched a rule, got a `[REDACTED:…]` marker stamped on them, and were
 * written to disk anyway. The second group is the worse one — a marker is an
 * affirmative claim that the secret was handled, so a human reviewing the
 * transcript sees a mask and stops looking.
 */
interface CorpusRow {
  readonly name: string;
  /** The credential material. Not one character of this may survive. */
  readonly secret: string;
  /** A realistic line of agent output containing `secret`. */
  readonly input: string;
}

const CORPUS: readonly CorpusRow[] = [
  // --- shapes the rule set already covered ---
  { name: 'anthropic-api-key', secret: FAKE.anthropic, input: `key ${FAKE.anthropic} here` },
  { name: 'openai-api-key', secret: FAKE.openai, input: `key ${FAKE.openai} here` },
  { name: 'github-classic-token', secret: FAKE.github, input: `push with ${FAKE.github} now` },
  { name: 'gitlab-token', secret: FAKE.gitlab, input: `ci ${FAKE.gitlab} here` },
  { name: 'slack-token', secret: FAKE.slack, input: `bot ${FAKE.slack} up` },
  { name: 'aws-access-key-id', secret: FAKE.aws, input: `id ${FAKE.aws} here` },
  { name: 'google-api-key', secret: FAKE.google, input: `maps ${FAKE.google} here` },
  { name: 'huggingface-token', secret: FAKE.hf, input: `hub ${FAKE.hf} here` },
  { name: 'npm-token', secret: FAKE.npm, input: `registry ${FAKE.npm} here` },
  { name: 'jwt', secret: FAKE.jwt, input: `session ${FAKE.jwt} ok` },
  {
    name: 'parallel-code-mcp-token',
    secret: rep(32, 'z'),
    input: `env PARALLEL_CODE_MCP_TOKEN="${rep(32, 'z')}" set`,
  },
  {
    name: 'token-in-url-query',
    secret: rep(32, 'h'),
    input: `open http://192.168.1.4:7777/?token=${rep(32, 'h')} now`,
  },
  {
    name: 'generic-assignment-plain',
    secret: 'hunter2hunter2hunter2',
    input: 'export DB_PASSWORD=hunter2hunter2hunter2 done',
  },

  // --- never matched at all before this change ---
  {
    name: 'github-fine-grained-pat',
    secret: 'github_pat_11AABBCCD0' + rep(59, 'x'),
    input: `gh auth login --with-token github_pat_11AABBCCD0${rep(59, 'x')} done`,
  },
  {
    name: 'stripe-live-secret-key',
    secret: 'sk_live_51H8xQ2eZvKYlo2C' + rep(24, 'R'),
    input: `billing sk_live_51H8xQ2eZvKYlo2C${rep(24, 'R')} done`,
  },
  {
    name: 'stripe-restricted-key',
    secret: 'rk_live_51H8xQ2eZvKYlo2C' + rep(24, 'S'),
    input: `billing rk_live_51H8xQ2eZvKYlo2C${rep(24, 'S')} done`,
  },
  {
    name: 'sendgrid-api-key',
    secret: `SG.${rep(22, 'a')}.${rep(43, 'b')}`,
    input: `mail SG.${rep(22, 'a')}.${rep(43, 'b')} done`,
  },
  {
    name: 'age-secret-key',
    secret: 'AGE-SECRET-KEY-1QQQ' + rep(40, 'Q'),
    input: `sops AGE-SECRET-KEY-1QQQ${rep(40, 'Q')} done`,
  },
  {
    name: 'azure-storage-account-key',
    secret: rep(86, 'C') + '==',
    input:
      `AZURE_CONN=DefaultEndpointsProtocol=https;AccountName=devstore;AccountKey=${rep(86, 'C')}` +
      '==;EndpointSuffix=core.windows.net done',
  },
  {
    name: 'authorization-bearer-header',
    secret: 'abcdef1234567890abcdef1234567890',
    input: 'curl -H Authorization: Bearer abcdef1234567890abcdef1234567890 done',
  },
  {
    name: 'authorization-basic-header',
    secret: 'YWxpY2U6aHVudGVyMg' + rep(20, 'D'),
    input: `curl -H Authorization: Basic YWxpY2U6aHVudGVyMg${rep(20, 'D')} done`,
  },
  {
    name: 'postgres-url-credentials',
    secret: 'appuser:s3cr3tP4ss',
    input: 'psql postgres://appuser:s3cr3tP4ss@db.internal:5432/prod done',
  },
  {
    name: 'mongodb-srv-url-credentials',
    secret: 'admin:MyP%40ssw0rd',
    input: 'connect mongodb+srv://admin:MyP%40ssw0rd@cluster0.abcde.mongodb.net/prod done',
  },
  {
    name: 'redis-url-credentials',
    secret: 'supersecretpassword123',
    input: 'cache redis://:supersecretpassword123@10.0.0.5:6379/0 done',
  },
  {
    name: 'https-git-url-credentials',
    secret: 'alice:hunter2hunter2',
    input: 'git clone https://alice:hunter2hunter2@git.internal/repo.git done',
  },
  {
    name: 'pem-encrypted-private-key',
    secret: PEM_ENC_BODY,
    input:
      'cat key.pem\n-----BEGIN ENCRYPTED PRIVATE KEY-----\n' +
      PEM_ENC_BODY +
      '\n-----END ENCRYPTED PRIVATE KEY-----\ndone\n',
  },
  {
    name: 'aws-secret-access-key-json',
    secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    input: '{ "SecretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" }',
  },
  {
    name: 'token-in-url-path',
    secret: rep(32, 'k'),
    input: `fetch https://ci.internal/api/v1/token/${rep(32, 'k')} done`,
  },
  {
    name: 'slack-webhook-url',
    secret: `T00000000/B00000000/${rep(24, 'X')}`,
    input: `post to https://hooks.slack.com/services/T00000000/B00000000/${rep(24, 'X')} done`,
  },
  {
    name: 'google-oauth-client-secret',
    secret: 'GOCSPX-' + rep(28, 'a'),
    input: `oauth GOCSPX-${rep(28, 'a')} done`,
  },
  {
    name: 'atlassian-api-token',
    secret: 'ATATT3x' + rep(60, 'F') + '=A1B2C3D4',
    input: `jira ATATT3x${rep(60, 'F')}=A1B2C3D4 done`,
  },
  {
    name: 'digitalocean-token',
    secret: 'dop_v1_' + rep(64, 'a'),
    input: `doctl dop_v1_${rep(64, 'a')} done`,
  },
  {
    name: 'doppler-service-token',
    secret: 'dp.pt.' + rep(44, 'a'),
    input: `doppler dp.pt.${rep(44, 'a')} done`,
  },
  {
    name: 'shopify-access-token',
    secret: 'shpat_' + rep(32, 'a'),
    input: `shopify shpat_${rep(32, 'a')} done`,
  },
  {
    name: 'telegram-bot-token',
    secret: '1234567890:AA' + rep(33, 'H'),
    input: `telegram 1234567890:AA${rep(33, 'H')} done`,
  },
  {
    name: 'pypi-token',
    secret: 'pypi-AgEIcHlwaS5vcmc' + rep(70, 'A'),
    input: `twine pypi-AgEIcHlwaS5vcmc${rep(70, 'A')} done`,
  },
  {
    name: 'linear-api-key',
    secret: 'lin_api_' + rep(40, 'a'),
    input: `linear lin_api_${rep(40, 'a')} done`,
  },
  {
    name: 'mailgun-api-key',
    secret: 'key-' + rep(32, 'a'),
    input: `mailgun key-${rep(32, 'a')} done`,
  },
  {
    name: 'databricks-token',
    secret: 'dapi' + rep(32, 'a'),
    input: `databricks dapi${rep(32, 'a')} done`,
  },
  {
    name: 'terraform-cloud-token',
    secret: 'abcdefghij1234.atlasv1.' + rep(60, 'a'),
    input: `terraform abcdefghij1234.atlasv1.${rep(60, 'a')} done`,
  },

  // --- matched a rule, got a marker, and were written to disk anyway ---
  {
    name: 'pem-rsa-private-key-body',
    secret: PEM_RSA_BODY,
    input:
      'cat id_rsa\n-----BEGIN RSA PRIVATE KEY-----\n' +
      PEM_RSA_BODY +
      '\n-----END RSA PRIVATE KEY-----\ndone\n',
  },
  {
    name: 'generic-assignment-punctuated-tail',
    secret: 'abcdefghijklmnop@QRSTUVWXYZ123456',
    input: 'export DB_PASSWORD=abcdefghijklmnop@QRSTUVWXYZ123456 done',
  },
  {
    name: 'mcp-token-punctuated-tail',
    secret: rep(24, 'z') + '==tail',
    input: `env PARALLEL_CODE_MCP_TOKEN=${rep(24, 'z')}==tail done`,
  },
];

/** Markers are output, not survival. Strip them before hunting for residue. */
const MARKER = /\[REDACTED:[a-z0-9-]+\]/g;

/** The longest run of `secret` that reached the output, or null when none did. */
function survivingFragment(secret: string, output: string, min = 6): string | null {
  const stripped = output.replace(MARKER, ' ');
  for (let len = secret.length; len >= min; len -= 1) {
    for (let i = 0; i + len <= secret.length; i += 1) {
      const fragment = secret.slice(i, i + len);
      if (fragment.trim().length < min) continue;
      if (stripped.includes(fragment)) return fragment;
    }
  }
  return null;
}

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

describe('a rule that fires leaves nothing behind', () => {
  // The invariant this whole module exists to hold. Not "the marker appeared",
  // not "the header is gone" — no run of the credential, anywhere, at all.
  it.each(CORPUS.map((row) => [row.name, row] as const))(
    'removes every trace of the %s fixture',
    (_name, row) => {
      const result = redactSecrets(row.input);
      expect(result.rules.length).toBeGreaterThan(0);
      expect(result.text).not.toContain(row.secret);
      expect(survivingFragment(row.secret, result.text)).toBeNull();
    },
  );

  it('leaves no value character hanging off the right of any marker', () => {
    // This is the structural form of the same claim, and it is the one that
    // generalises to rules nobody has written yet: a match is always widened to
    // the end of its whitespace-or-quote-delimited value, so a marker is always
    // followed by a delimiter or by end of text. If a future rule stops halfway
    // through a password, this fails without anyone remembering to add a case.
    for (const row of CORPUS) {
      const { text } = redactSecrets(row.input);
      expect(text, `${row.name} left a tail`).not.toMatch(/\[REDACTED:[a-z0-9-]+\][^\s'"`]/);
    }
  });

  it('counts the corpus, so a silently shrinking corpus is a failing test', () => {
    expect(CORPUS).toHaveLength(43);
    expect(new Set(CORPUS.map((r) => r.name)).size).toBe(CORPUS.length);
  });
});

describe('the three defects this wave was opened for', () => {
  it('takes the whole PEM block, not just the header line', () => {
    // The old rule matched `-----BEGIN … PRIVATE KEY-----` and nothing else. It
    // stamped a marker over the header and wrote 2048 bits of key material to
    // disk underneath it, inside a 4096-character `detail` field with room to
    // spare. The old test asserted the header was gone and stopped there, which
    // is exactly why it never caught this.
    const body = 'MIIEowIBAAKCAQEAvBpXk9SECRETKEYMATERIAL0000';
    const input = `-----BEGIN RSA PRIVATE KEY-----\n${body}\nQIDAQABAoIBAQCsecondline11111\n-----END RSA PRIVATE KEY-----\n`;
    const result = redactSecrets(input);

    expect(result.rules).toContain('private-key');
    expect(result.text).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(result.text).not.toContain(body);
    expect(result.text).not.toContain('QIDAQABAoIBAQCsecondline11111');
    expect(result.text).not.toContain('END RSA PRIVATE KEY');
    expect(result.text).toBe('[REDACTED:private-key]\n');
  });

  it('takes a truncated PEM block that never gets an END line', () => {
    // A key that hit the detail cap mid-body has no terminator. Every one of
    // those base64 lines is still key material, so the scan runs to the end.
    const input = `-----BEGIN OPENSSH PRIVATE KEY-----\n${rep(60, 'b')}\n${rep(60, 'c')}`;
    const result = redactSecrets(input);
    expect(result.rules).toContain('private-key');
    expect(result.text).toBe('[REDACTED:private-key]');
  });

  it('stops the PEM scan at the first line that is plainly not key material', () => {
    // Over-redaction is the safe direction, but it should still be bounded:
    // prose after the block survives, key material does not.
    const input = `-----BEGIN PRIVATE KEY-----\n${rep(40, 'd')}\nthen I ran the tests (all green)\n`;
    const result = redactSecrets(input);
    expect(result.text).not.toContain(rep(40, 'd'));
    expect(result.text).toContain('then I ran the tests (all green)');
  });

  it('flags an ENCRYPTED private key, which the old alternation did not list', () => {
    const input = `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${rep(50, 'e')}\n-----END ENCRYPTED PRIVATE KEY-----`;
    const result = redactSecrets(input);
    expect(result.rules).toContain('private-key');
    expect(result.text).not.toContain(rep(50, 'e'));
  });

  it('takes a password past the first character outside the value class', () => {
    // `[A-Za-z0-9/+=_-]{16,}` stopped at `@` and wrote the rest of the password
    // to disk under a marker that claimed it had been handled.
    const result = redactSecrets('export DB_PASSWORD=abcdefghijklmnop@QRSTUVWXYZ123456');
    expect(result.rules).toContain('generic-assignment');
    expect(result.text).toBe('export [REDACTED:generic-assignment]');
  });

  it.each([
    ['a dot', 'API_TOKEN=aaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbb', '.bbbbbbbbbbbbbbbbbbbb'],
    ['an exclamation', 'API_TOKEN=aaaaaaaaaaaaaaaaaaaa!tail-of-the-password', '!tail'],
    ['a hash', 'API_TOKEN=aaaaaaaaaaaaaaaaaaaa#tail-of-the-password', '#tail'],
    ['a percent', 'API_TOKEN=aaaaaaaaaaaaaaaaaaaa%tail-of-the-password', '%tail'],
    ['a caret', 'API_TOKEN=aaaaaaaaaaaaaaaaaaaa^tail-of-the-password', '^tail'],
    ['a paren', 'API_TOKEN=aaaaaaaaaaaaaaaaaaaa(tail-of-the-password', '(tail'],
  ])('takes the tail of a password interrupted by %s', (_label, input, tail) => {
    const result = redactSecrets(input);
    expect(result.text).not.toContain(tail);
    expect(result.text).toBe('[REDACTED:generic-assignment]');
  });

  it('takes the tail past an escaped quote, which JSON output is full of', () => {
    // `\"` is inside the value, not the end of it. Breaking there would leave
    // the rest of the credential on disk under a marker claiming otherwise.
    const result = redactSecrets('API_TOKEN=aaaaaaaaaaaaaaaaaaaa\\"tail-of-the-password rest');
    expect(result.text).not.toContain('tail-of-the-password');
    expect(result.text).toBe('[REDACTED:generic-assignment] rest');
  });

  it('takes the tail past an escaped space, which shell values contain', () => {
    const result = redactSecrets('API_TOKEN=aaaaaaaaaaaaaaaaaaaa\\ tail-of-the-password rest');
    expect(result.text).not.toContain('tail-of-the-password');
    expect(result.text).toBe('[REDACTED:generic-assignment] rest');
  });

  it('never runs a mask past the end of the line, escapes or not', () => {
    // A newline is an unconditional stop. An escaped newline is still a line
    // ending, and over-consuming into the next event is not the safe direction.
    const result = redactSecrets('API_TOKEN=aaaaaaaaaaaaaaaaaaaa\\\nnext line survives');
    expect(result.text).toContain('next line survives');
  });

  it('takes the tail of the project MCP token too', () => {
    const result = redactSecrets(`env PARALLEL_CODE_MCP_TOKEN=${rep(24, 'z')}==tail`);
    expect(result.rules).toContain('parallel-code-mcp-token');
    expect(result.text).toBe('env [REDACTED:parallel-code-mcp-token]');
  });

  it('masks the fine-grained GitHub PAT, the likeliest credential in this app', () => {
    // A tool that shells out to `git` and `gh` will see `github_pat_` before it
    // sees anything else. The old `gh[pousr]_` alternation did not cover it.
    const pat = 'github_pat_11AABBCCD0' + rep(59, 'x');
    const result = redactSecrets(`gh auth login --with-token ${pat}`);
    expect(result.rules).toContain('github-token');
    expect(result.text).not.toContain('github_pat_');
    expect(result.text).not.toContain(rep(10, 'x'));
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

  it('masks a token carried in a URL path segment, not a query parameter', () => {
    const result = redactSecrets(`fetch https://ci.internal/api/v1/token/${rep(32, 'k')} now`);
    expect(result.text).not.toContain(rep(32, 'k'));
    expect(result.rules).toContain('token-in-url-path');
  });

  it.each([
    ['postgres', 'psql postgres://appuser:s3cr3tP4ss@db.internal:5432/prod', 's3cr3tP4ss'],
    [
      'mongodb+srv',
      'mongodb+srv://admin:MyP%40ssw0rd@cluster0.abcde.mongodb.net/x',
      'MyP%40ssw0rd',
    ],
    [
      'redis with no user',
      'redis://:supersecretpassword123@10.0.0.5:6379/0',
      'supersecretpassword123',
    ],
    [
      'https git remote',
      'git clone https://alice:hunter2hunter2@git.internal/r.git',
      'hunter2hunter2',
    ],
  ])('masks credentials in the userinfo of a %s URL', (_label, input, password) => {
    const result = redactSecrets(input);
    expect(result.text).not.toContain(password);
    expect(result.rules).toContain('url-credentials');
  });

  it('leaves an ordinary URL with a port alone', () => {
    // `host:port` is not `user:password` — the userinfo rule must not fire on it.
    expect(redactSecrets('serving on http://localhost:3000/tasks').rules).toEqual([]);
  });

  it.each([
    ['Bearer', 'curl -H Authorization: Bearer abcdef1234567890abcdef1234567890'],
    ['Basic', 'curl -H Authorization: Basic YWxpY2U6aHVudGVyMkRERERERA=='],
  ])('masks an Authorization: %s header', (_label, input) => {
    const result = redactSecrets(input);
    expect(result.rules).toContain('authorization-header');
    expect(result.text).toBe('curl -H [REDACTED:authorization-header]');
  });

  it('masks a credential serialised as JSON, where a quote precedes the colon', () => {
    // `"SecretAccessKey": "…"` — the quote between keyword and separator is why
    // every JSON-shaped credential used to walk straight through.
    const result = redactSecrets(
      '{ "SecretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" }',
    );
    expect(result.rules).toContain('generic-assignment');
    expect(result.text).not.toContain('wJalrXUtnFEMI');
  });

  it('masks a generic shell assignment, the shape agent output actually produces', () => {
    const result = redactSecrets('export DB_PASSWORD=hunter2hunter2hunter2');
    expect(result.text).not.toContain('hunter2hunter2hunter2');
    expect(result.rules).toContain('generic-assignment');
  });

  it('masks a quoted value containing spaces', () => {
    const result = redactSecrets('DB_PASSWORD="correct horse battery staple"');
    expect(result.text).not.toContain('horse battery');
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
    expect(redactSecrets(FAKE.anthropic).rules).toEqual(['anthropic-api-key']);
  });

  it('names the more specific rule when two rules overlap, and removes the union', () => {
    // The generic rule matches wider here (it starts at the variable name), so
    // the union is what disappears — but the marker still says which vendor.
    const result = redactSecrets(`exported ANTHROPIC_API_KEY=${FAKE.anthropic}`);
    expect(result.text).toBe('exported [REDACTED:anthropic-api-key]');
    expect(result.text).not.toContain('sk-ant-');
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

  it('does not catch a bare high-entropy string with no prefix and no label', () => {
    // A naked 40-character AWS secret access key is byte-for-byte a git object
    // id. The labelled form is caught; this one cannot be, and pretending
    // otherwise would mean masking every commit hash in the transcript.
    expect(redactSecrets('object 8f3a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c').rules).toEqual([]);
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

  it.each(
    // Every rule, including any rule added after this was written, gets fed
    // 20,000 hostile characters built from its own prefix. This is the part of
    // the DoS bound that does not need maintaining: it enumerates the rule list.
    REDACTION_RULES.map((rule) => [rule.id, rule.pattern.source] as const),
  )('bounds the cost of the %s rule on 20,000 hostile characters', (_id, source) => {
    // A rough literal prefix lifted off the pattern: enough to get the engine
    // past the anchor and into the quantified run where backtracking lives.
    const literal = source.replace(/\\b|\^/g, '').match(/^[A-Za-z0-9_@:/.\- ]+/)?.[0] ?? '';
    const inputs = [
      literal + 'a'.repeat(20_000),
      literal + 'a'.repeat(20_000) + '!',
      literal + '0'.repeat(20_000) + '"',
      literal + 'a='.repeat(10_000),
      literal + ('a'.repeat(60) + '\n').repeat(330),
      literal.repeat(Math.max(1, Math.floor(20_000 / Math.max(1, literal.length)))),
      'x'.repeat(20_000),
    ];
    const started = Date.now();
    for (const input of inputs) redactSecrets(input);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('bounds the cost of a PEM header that never terminates', () => {
    // The block extender walks forward line by line. Many unterminated headers
    // must not turn that into a quadratic scan.
    const inputs = [
      '-----BEGIN RSA PRIVATE KEY-----\n' + ('QUJD'.repeat(15) + '\n').repeat(330),
      '-----BEGIN RSA PRIVATE KEY-----\n'.repeat(640) + 'a'.repeat(1000),
      '-----BEGIN PRIVATE KEY-----' + 'A'.repeat(20_000),
    ];
    const started = Date.now();
    for (const input of inputs) redactSecrets(input);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('bounds the cost of a URL userinfo run that never reaches an @', () => {
    const inputs = [
      'postgres://user:' + 'a'.repeat(20_000),
      'postgres://' + 'a'.repeat(20_000),
      'redis://:' + 'a:'.repeat(10_000),
    ];
    const started = Date.now();
    for (const input of inputs) redactSecrets(input);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('bounds the cost of an assignment whose quoted value never closes', () => {
    const inputs = [
      'password="' + 'a'.repeat(20_000),
      "password='" + 'a'.repeat(20_000),
      'password=' + 'a'.repeat(20_000),
      'password' + '='.repeat(20_000),
      ('password=' + 'a'.repeat(16) + ' ').repeat(1000),
    ];
    const started = Date.now();
    for (const input of inputs) redactSecrets(input);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('bounds the cost of the escape scan the value widener performs', () => {
    // Widening walks backwards over backslashes at every quote or space it
    // meets. Densely escaped input must stay linear, not quadratic.
    const inputs = [
      'password=' + 'a'.repeat(16) + '\\'.repeat(20_000) + '"',
      'password=' + 'a'.repeat(16) + '\\ '.repeat(10_000),
      'password=' + 'a'.repeat(16) + '\\\\"'.repeat(6_600),
      'password=' + 'a'.repeat(16) + ('\\'.repeat(40) + '" ').repeat(470),
    ];
    const started = Date.now();
    for (const input of inputs) redactSecrets(input);
    expect(Date.now() - started).toBeLessThan(2000);
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

  it('declares every pattern global, or matchAll would throw on the write path', () => {
    for (const rule of REDACTION_RULES) {
      expect(rule.pattern.flags, `${rule.id} is missing the g flag`).toContain('g');
    }
  });

  it('never repeats a group, which is how nested quantifiers get in', () => {
    // `(…)+`, `(…)*` and `(…){n,}` are the shapes that turn a rule into a
    // denial-of-service on an agent-controlled write path. A group may be
    // optional; it may not repeat. This is a static check, so it holds for
    // rules that no fixture happens to exercise.
    for (const rule of REDACTION_RULES) {
      expect(rule.pattern.source, `${rule.id} repeats a group`).not.toMatch(/\)[*+{]/);
    }
  });

  it('keeps the generic catch-all last so specific rules win', () => {
    expect(REDACTION_RULES[REDACTION_RULES.length - 1].id).toBe('generic-assignment');
  });

  it('gives every rule an id that cannot appear inside its own marker as a match', () => {
    // Belt and braces on the fixed-point property: a marker for rule A fed
    // through the whole set must survive every rule, not just rule A.
    const allMarkers = REDACTION_RULES.map((r) => redactionMarker(r.id)).join(' ');
    expect(redactSecrets(allMarkers).text).toBe(allMarkers);
  });
});
