#!/usr/bin/env node
/* global console, process */

/**
 * Throwaway probe for the Huly read path (H7 prerequisite).
 *
 * The read path shipped in FK_PC-6 and has never once run against real
 * credentials, so nothing downstream of it can be trusted yet. This exercises
 * four of the five outstanding checks without needing the Electron UI; only
 * safeStorage persistence genuinely requires the app.
 *
 * The token never passes through the agent — it is read from the environment
 * by whoever runs this:
 *
 *   HULY_URL=https://huly.shigachen.me \
 *   HULY_WORKSPACE=scottworkspace \
 *   HULY_TOKEN=<token> \
 *   HULY_PROJECT=FK_PC \
 *   node scripts/probe-huly.mjs
 *
 * Prints a report and exits non-zero if a check fails. Reads only; creates,
 * updates and deletes nothing.
 */
const { HULY_URL, HULY_WORKSPACE, HULY_TOKEN, HULY_PROJECT = 'FK_PC' } = process.env;

if (!HULY_URL || !HULY_WORKSPACE || !HULY_TOKEN) {
  console.error('Missing HULY_URL, HULY_WORKSPACE or HULY_TOKEN. See the header of this file.');
  process.exit(2);
}

// Check 3 is "are the model-transaction warnings actually suppressed" — so
// count them rather than hiding them. The client logs these on console.warn,
// which an earlier wave got wrong by intercepting console.log instead.
let warnCount = 0;
const warnSamples = [];
const realWarn = console.warn.bind(console);
console.warn = (...args) => {
  warnCount++;
  if (warnSamples.length < 3) warnSamples.push(args.map(String).join(' ').slice(0, 120));
};

const fail = [];
const ok = (label, detail) => console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`);
const bad = (label, detail) => {
  fail.push(label);
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
};

const main = async () => {
  const { default: clientMod } = await import('@hcengineering/api-client').then((m) => ({
    default: m.default ?? m,
  }));
  const trackerMod = await import('@hcengineering/tracker');
  const tracker = trackerMod.default ?? trackerMod;
  const coreMod = await import('@hcengineering/core');

  console.log('\n=== Check 2: connect and list projects ===');
  const conn = await clientMod.connect(HULY_URL, {
    token: HULY_TOKEN,
    workspace: HULY_WORKSPACE,
  });

  const projects = await conn.findAll(tracker.class.Project, {});
  const identifiers = projects.map((p) => p.identifier).filter((x) => typeof x === 'string');
  if (identifiers.length > 0)
    ok('connected', `${identifiers.length} projects: ${identifiers.join(', ')}`);
  else bad('connected but no projects returned');

  console.log('\n=== Check 4: issue list and ordering ===');
  const project = projects.find((p) => p.identifier === HULY_PROJECT);
  if (!project) {
    bad(`project ${HULY_PROJECT} not found`);
  } else {
    const issues = await conn.findAll(
      tracker.class.Issue,
      { space: project._id },
      { limit: 100, sort: { modifiedOn: coreMod.SortingOrder.Descending } },
    );
    ok(`${HULY_PROJECT} issues`, `${issues.length} found`);

    const desc = issues.every(
      (it, i) => i === 0 || (issues[i - 1].modifiedOn ?? 0) >= (it.modifiedOn ?? 0),
    );
    if (desc) ok('sorted newest-modified first');
    else bad('sort order is not descending by modifiedOn');

    console.log('\n=== Check 5: what the status field actually holds ===');
    const first = issues[0];
    if (!first) {
      bad('no issue to inspect');
    } else {
      const status = first.status;
      console.log(`  identifier : ${first.identifier}`);
      console.log(`  title      : ${String(first.title).slice(0, 60)}`);
      console.log(`  status     : ${JSON.stringify(status)}`);
      console.log(`  typeof     : ${typeof status}`);
      // The suspicion: Huly stores Issue.status as Ref<IssueStatus> — a document
      // id, not a display label. TypeScript sees a string either way, so this is
      // the only way to find out. An opaque id here means the picker would show
      // gibberish the moment anyone renders it.
      const looksLikeId = typeof status === 'string' && /^[0-9a-f-]{16,}$/i.test(status);
      if (looksLikeId)
        bad('status is an opaque id, not a label', 'mapIssue passes it through as a string');
      else ok('status is not an opaque id', 'render it and see');
    }
  }

  console.log('\n=== Check 3: model-transaction warnings ===');
  if (warnCount === 0) ok('no console.warn output during the whole run');
  else bad(`${warnCount} console.warn lines leaked`, warnSamples[0] ?? '');

  await conn?.close?.();
};

main()
  .then(() => {
    console.warn = realWarn;
    console.log(`\n${fail.length === 0 ? 'ALL CHECKS PASSED' : `FAILED: ${fail.join(' / ')}`}\n`);
    process.exit(fail.length === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.warn = realWarn;
    console.error('\nProbe threw:', e?.message ?? e);
    console.error('\nThis is itself a result — the read path has never run against a real server.');
    process.exit(1);
  });
