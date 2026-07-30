import { describe, it, expect } from 'vitest';
import {
  sanitisePromptBody,
  buildAutomatedPrompt,
  AUTOMATED_PROMPT_PROVENANCE,
  MAX_PROVENANCE_HEADER_BYTES,
} from './prompt-sanitise.js';

const ESC = '\x1b';

describe('sanitisePromptBody', () => {
  it('leaves ordinary prose untouched', () => {
    const text = 'Please rebase onto main and re-run npm test.';
    expect(sanitisePromptBody(text)).toBe(text);
  });

  it('preserves newlines and tabs so multi-line prompts stay legible', () => {
    expect(sanitisePromptBody('one\ntwo\n\tindented')).toBe('one\ntwo\n\tindented');
  });

  it('strips CSI colour sequences', () => {
    expect(sanitisePromptBody(`${ESC}[31mdanger${ESC}[0m`)).toBe('danger');
  });

  it('strips OSC sequences that can retitle or drive the terminal', () => {
    expect(sanitisePromptBody(`${ESC}]0;pwned\x07hello`)).toBe('hello');
  });

  it('strips a bare ESC that no escape-sequence pattern matches', () => {
    expect(sanitisePromptBody(`abc${ESC}def`)).toBe('abcdef');
  });

  it('removes the carriage return that would submit the line early', () => {
    expect(sanitisePromptBody('run this\rrm -rf /')).toBe('run this\nrm -rf /');
  });

  it('normalises CRLF to LF without losing line structure', () => {
    expect(sanitisePromptBody('one\r\ntwo')).toBe('one\ntwo');
  });

  it('removes NUL, BEL, backspace and DEL', () => {
    expect(sanitisePromptBody('a\x00b\x07c\x08d\x7fe')).toBe('abcde');
  });

  it('removes C1 controls, including the 8-bit CSI introducer', () => {
    expect(sanitisePromptBody('a\u009b31mb\u0085c\u009fd')).toBe('abcd');
  });

  it('neutralises a bracketed-paste terminator hidden in the payload', () => {
    // ESC[201~ ends paste mode early, so everything after it would be
    // interpreted as live keystrokes rather than as pasted text.
    const attack = `looks harmless${ESC}[201~\r/exit\r`;
    const out = sanitisePromptBody(attack);
    expect(out).not.toContain(ESC);
    expect(out).not.toContain('201~');
    expect(out).not.toContain('\r');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitisePromptBody('  hello  ')).toBe('hello');
  });

  it('collapses to empty when the payload is nothing but control characters', () => {
    expect(sanitisePromptBody(`${ESC}[31m \r${ESC}[0m`)).toBe('');
  });

  it('is idempotent — sanitising twice equals sanitising once', () => {
    const attack = `${ESC}[31mred${ESC}]0;title\x07\rmore\x00 `;
    const once = sanitisePromptBody(attack);
    expect(sanitisePromptBody(once)).toBe(once);
  });

  it('leaves shell metacharacters alone — they are only dangerous once a shell reads them', () => {
    const text = 'run `git status` && echo "$HOME"; ls | wc -l';
    expect(sanitisePromptBody(text)).toBe(text);
  });

  it('keeps non-ASCII text intact', () => {
    expect(sanitisePromptBody('請重新執行測試 ✅')).toBe('請重新執行測試 ✅');
  });
});

describe('buildAutomatedPrompt', () => {
  it('prefixes the provenance header when marking is requested', () => {
    const built = buildAutomatedPrompt('do the thing', { withProvenance: true });
    expect(built.text).toBe(`${AUTOMATED_PROMPT_PROVENANCE}\ndo the thing`);
    expect(built.body).toBe('do the thing');
  });

  it('omits the header when marking is not requested', () => {
    const built = buildAutomatedPrompt('do the thing', { withProvenance: false });
    expect(built.text).toBe('do the thing');
  });

  it('sanitises the body before the header is attached', () => {
    const built = buildAutomatedPrompt(`${ESC}[31mred \r`, { withProvenance: true });
    expect(built.body).toBe('red');
    expect(built.text).toBe(`${AUTOMATED_PROMPT_PROVENANCE}\nred`);
  });

  it('reports how many characters sanitisation removed', () => {
    expect(buildAutomatedPrompt('clean text', { withProvenance: true }).removed).toBe(0);
    expect(buildAutomatedPrompt(`${ESC}[31mred`, { withProvenance: true }).removed).toBeGreaterThan(
      0,
    );
  });

  it('reports an empty body so callers can reject a payload that sanitised away', () => {
    expect(buildAutomatedPrompt(`${ESC}[31m `, { withProvenance: true }).body).toBe('');
  });

  it('keeps the provenance header inside its declared byte budget', () => {
    expect(Buffer.byteLength(AUTOMATED_PROMPT_PROVENANCE, 'utf8')).toBeLessThanOrEqual(
      MAX_PROVENANCE_HEADER_BYTES,
    );
  });

  it('uses a header that carries no imperative the receiving CLI could act on', () => {
    // The header states a fact about the message. It deliberately issues no
    // instruction, because the receiving CLI reads it as ordinary prompt text.
    expect(AUTOMATED_PROMPT_PROVENANCE).not.toMatch(/\b(?:run|execute|ignore|you must|please)\b/i);
    expect(AUTOMATED_PROMPT_PROVENANCE.includes('\n')).toBe(false);
  });

  it('survives the header itself passing back through sanitisation', () => {
    const built = buildAutomatedPrompt('follow up', { withProvenance: true });
    expect(sanitisePromptBody(built.text)).toBe(built.text);
  });
});
