// Runs the real adapter, matcher and reconciliation with an in-memory store.
// No network or production writes: node tools/portfoliofit-identity-guard.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const admin = source('admin/admin.js');
const start = admin.indexOf('  function verifyFromSim(');
const end = admin.indexOf('\n  /*', start);
assert(start >= 0 && end > start);
const mark = { ts: 100, session: 'SEPT', src: 'client' };
const student = (id, completed = true) => ({
  uid: 'uid-' + id, studentId: id, email: id + '@example.com',
  name: id, completed: completed ? { portfoliofit: { ...mark } } : {}
});

async function run(parts, rows, auto = false) {
  const writes = [], prompts = [];
  const before = JSON.stringify(rows);
  const D = {
    collection: () => ({}),
    getDocs: async () => ({ size: parts.length,
      forEach: fn => parts.forEach((p, i) => fn({ id: 'p' + i, data: () => p })) })
  };
  const sandbox = {
    window: { confirm: text => { prompts.push(text); return true; } },
    lastRows: rows, CFG: { sims: { portfoliofit: { active: true } } },
    simFirestore: async () => ({ D, fs: {} }),
    P: { firebase: async () => ({
      listStudents: async () => rows,
      stampCompleted: async (...args) => { writes.push(['stamp', ...args]); },
      revokeCompletion: async (...args) => { writes.push(['revoke', ...args]); }
    }) },
    dupesShown: {}, showDuplicatesDialog: () => {}
  };
  vm.createContext(sandbox);
  for (const name of ['completions.js', 'admin/match.js', 'admin/verify.js']) {
    vm.runInContext(source(name), sandbox, { filename: name });
  }
  vm.runInContext('var C = window.SIMP_COMPLETIONS;\n' + admin.slice(start, end), sandbox);
  const result = await sandbox.verifyFromSim({ key: 'portfoliofit', title: 'PortfolioFit',
    verify: { adapter: 'portfoliofit' } }, { auto });
  assert.equal(JSON.stringify(rows), before, 'reconciliation never mutates input records');
  return { result, writes, prompts };
}

const anonymous = { status: 'done', sessionId: 'SEPT' };
const identified = { status: 'done', sessionId: 'OLDER', studentId: 'known', updatedAt: 200 };
// The incident: older identifiable records hide an entire anonymous session.
for (const auto of [false, true]) {
  const r = await run([identified, ...Array.from({ length: 28 }, () => anonymous)],
    [student('known'), ...Array.from({ length: 28 }, (_, i) => student('sept-' + i))], auto);
  assert.equal(r.prompts.length, 0, 'no removal prompt for anonymous finishers');
  assert.equal(r.writes.length, 0, 'existing completion markers remain intact');
  assert.match(r.result, /28 completed PortfolioFit record/);
  assert.match(r.result, /28 unmatched completion mark\(s\) were preserved/);
  assert.doesNotMatch(r.result, /roster already matches/);
}
// Even one unmatched mark is protected; no percentage threshold.
const mixed = await run([identified, anonymous], [student('known', false), student('unmatched')]);
assert.deepEqual(mixed.writes.map(w => w[0]), ['stamp'], 'safe positive matches still sync');
assert.equal(mixed.prompts.length, 0);
assert.match(mixed.result, /1 unmatched completion mark\(s\) were preserved/);
// An entirely anonymous collection is a useful incomplete result, not an error.
const allAnonymous = await run([anonymous], [student('unmatched')]);
assert.equal(allAnonymous.writes.length, 0);
assert.match(allAnonymous.result, /verification is incomplete/);
// Valid email-only identities remain usable, including with a blank ID.
const emailOnly = await run([{ ...anonymous, email: 'known@example.com' }], [student('known', false)]);
assert.deepEqual(emailOnly.writes.map(w => w[0]), ['stamp']);
assert.doesNotMatch(emailOnly.result, /no usable student ID/);
// Unfinished anonymous records do not incorrectly block legitimate removals.
const completeCoverage = await run([identified, { status: 'playing' }],
  [student('known'), student('deleted')]);
assert.equal(completeCoverage.prompts.length, 1);
assert.deepEqual(completeCoverage.writes.map(w => w[0]), ['revoke']);
// Ambiguous email answers are not silently treated as usable identity.
const ambiguous = await run([{ ...anonymous, registration: { a: 'a@example.com', b: 'b@example.com' } }],
  [student('unmatched')]);
assert.equal(ambiguous.prompts.length, 0);
assert.match(ambiguous.result, /1 completed PortfolioFit record/);
console.log('PortfolioFit identity guard passed: anonymous, mixed, email-only, automatic and removal cases.');
