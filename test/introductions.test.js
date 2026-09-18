import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import {
  proposeIntroduction, recordDecision, viewFor, bothRecommend, awaiting,
  isExpired, expire, pendingFor, readableTranscript,
} from '../src/core/introductions.js';
import { Store } from '../src/store.js';
import { tuning } from '../src/config.js';
import { runScreenings, introductionsFor, respondToIntroduction, expireIntroductions, joinMember, blockMember } from '../src/service.js';
import { handle } from '../src/api.js';
import { member, daysAgo, NOW, DAY } from './helpers.js';

const CO = {
  commitment: 'full-time', stage: 'prototype', timeline: 'now', domains: ['climate'],
  brings: ['engineering'], needs: ['sales'], equityStance: 'equal', runwayMonths: 12, priorFounder: false,
};
const CO2 = { ...CO, brings: ['sales'], needs: ['engineering'] };

const verdict = (v, extra = {}) => ({
  verdict: v, confidence: 0.7, headline: `${v} headline`, why: [`because ${v}`],
  watchOuts: [], openQuestions: [], suggestedFirstStep: 'One coffee.', ...extra,
});

const screening = () => ({
  id: 's1', pairIds: ['a', 'b'], intent: 'cofounder', state: 'complete',
  turns: [
    { speakerId: 'a', message: 'A said this', unknowns: ['secret A question'], concerns: ['secret A concern'], at: daysAgo(1) },
    { speakerId: 'b', message: 'B said this', unknowns: [], concerns: [], at: daysAgo(1) },
  ],
});

const intro = (verdicts, extra = {}) => ({
  id: 'i1',
  ...proposeIntroduction({ screening: screening(), verdicts, now: NOW }),
  ...extra,
});

async function tmpStore() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'thirdplace-intro-'));
  return Store.open(path.join(dir, 'db.json'));
}

async function screenedPair(now = new Date()) {
  const store = await tmpStore();
  const a = await joinMember(store, { ...member({ displayName: 'Ada', intents: ['cofounder'], intentProfiles: { cofounder: CO } }), id: undefined });
  const b = await joinMember(store, { ...member({ displayName: 'Bo', intents: ['cofounder'], intentProfiles: { cofounder: CO2 } }), id: undefined });
  const done = await runScreenings(store, { now });
  return { store, a: store.member(a.id), b: store.member(b.id), done, now };
}

// --- the gate --------------------------------------------------------------

test('an introduction needs both delegates to recommend', () => {
  const pair = ['a', 'b'];
  assert.equal(bothRecommend({ a: verdict('recommend'), b: verdict('recommend') }, pair), true);
  assert.equal(bothRecommend({ a: verdict('recommend'), b: verdict('hold') }, pair), false);
  assert.equal(bothRecommend({ a: verdict('recommend'), b: verdict('pass') }, pair), false);
});

test('one hold is not a near miss to push through', () => {
  assert.equal(proposeIntroduction({ screening: screening(), verdicts: { a: verdict('recommend'), b: verdict('hold') } }), null);
});

test('a proposed introduction starts pending, with nobody having decided', () => {
  const i = intro({ a: verdict('recommend'), b: verdict('recommend') });
  assert.equal(i.status, 'pending');
  assert.deepEqual(awaiting(i).sort(), ['a', 'b']);
});

test('both approvals are needed; one approval leaves it pending', () => {
  const i = intro({ a: verdict('recommend'), b: verdict('recommend') });
  recordDecision(i, 'a', 'approve', { now: NOW });
  assert.equal(i.status, 'pending');
  assert.deepEqual(awaiting(i), ['b']);
  recordDecision(i, 'b', 'approve', { now: NOW });
  assert.equal(i.status, 'approved');
  assert.ok(i.resolvedAt);
});

test('one pass ends it immediately rather than making the other wait', () => {
  const i = intro({ a: verdict('recommend'), b: verdict('recommend') });
  recordDecision(i, 'b', 'pass', { now: NOW });
  assert.equal(i.status, 'declined');
  assert.ok(i.resolvedAt);
});

test('nobody can decide twice, decide for a resolved introduction, or decide as a stranger', () => {
  const i = intro({ a: verdict('recommend'), b: verdict('recommend') });
  recordDecision(i, 'a', 'approve', { now: NOW });
  assert.throws(() => recordDecision(i, 'a', 'pass', { now: NOW }), /already decided/);
  assert.throws(() => recordDecision(i, 'c', 'approve', { now: NOW }), /not a party/);
  assert.throws(() => recordDecision(i, 'a', 'maybe', { now: NOW }), /unknown decision/);
  recordDecision(i, 'b', 'pass', { now: NOW });
  assert.throws(() => recordDecision(i, 'b', 'approve', { now: NOW }), /already declined/);
});

test('an unanswered introduction goes stale instead of sitting forever', () => {
  const i = intro({ a: verdict('recommend'), b: verdict('recommend') });
  const later = new Date(NOW.getTime() + (tuning.screening.approvalExpiryDays + 1) * DAY);
  assert.equal(isExpired(i, NOW), false);
  assert.equal(isExpired(i, later), true);
  expire(i, later);
  assert.equal(i.status, 'expired');
});

test('a resolved introduction never expires out from under its result', () => {
  const i = intro({ a: verdict('recommend'), b: verdict('recommend') });
  recordDecision(i, 'a', 'approve', { now: NOW });
  recordDecision(i, 'b', 'approve', { now: NOW });
  const later = new Date(NOW.getTime() + 999 * DAY);
  expire(i, later);
  assert.equal(i.status, 'approved');
});

// --- privacy ---------------------------------------------------------------

test('each owner sees only their own agent’s verdict', () => {
  const i = intro({
    a: verdict('recommend', { headline: 'VERDICT-FOR-A', why: ['A-ONLY-REASON'] }),
    b: verdict('recommend', { headline: 'VERDICT-FOR-B', why: ['B-ONLY-REASON'] }),
  });
  const forA = JSON.stringify(viewFor(i, 'a', { screening: screening(), now: NOW }));
  assert.match(forA, /VERDICT-FOR-A/);
  assert.doesNotMatch(forA, /VERDICT-FOR-B/, 'the other side’s verdict leaked');
  assert.doesNotMatch(forA, /B-ONLY-REASON/);
});

test('a delegate’s private notes never reach either owner', () => {
  const i = intro({ a: verdict('recommend'), b: verdict('recommend') });
  const s = screening();
  for (const id of ['a', 'b']) {
    const view = JSON.stringify(viewFor(i, id, { screening: s, now: NOW }));
    assert.doesNotMatch(view, /secret A concern/, 'a delegate concern leaked into the transcript');
    assert.doesNotMatch(view, /secret A question/);
  }
  assert.deepEqual(Object.keys(readableTranscript(s)[0]).sort(), ['at', 'message', 'speakerId']);
});

test('a decline is never attributed to the person who declined', () => {
  const i = intro({ a: verdict('recommend'), b: verdict('recommend') });
  recordDecision(i, 'b', 'pass', { now: NOW });

  const forA = viewFor(i, 'a', { other: { displayName: 'B' }, screening: screening(), now: NOW });
  assert.equal(forA.stage, 'closed');
  assert.equal(forA.yourDecision, null);
  assert.equal(forA.other, null, 'the person who declined was still shown');
  assert.equal(forA.status, 'closed', 'the raw status revealed that someone actively declined');
  assert.doesNotMatch(JSON.stringify(forA), /declin|pass|rejected/i);

  // The person who decided does get told what they decided.
  const forB = viewFor(i, 'b', { other: { displayName: 'A' }, now: NOW });
  assert.equal(forB.yourDecision, 'pass');
  assert.match(forB.note, /You passed/);
});

test('a decline and a timeout are indistinguishable to the other person', () => {
  const declined = intro({ a: verdict('recommend'), b: verdict('recommend') });
  recordDecision(declined, 'b', 'pass', { now: NOW });

  const expired = intro({ a: verdict('recommend'), b: verdict('recommend') });
  const later = new Date(NOW.getTime() + (tuning.screening.approvalExpiryDays + 1) * DAY);
  expire(expired, later);

  const d = viewFor(declined, 'a', { other: { displayName: 'B' }, now: NOW });
  const e = viewFor(expired, 'a', { other: { displayName: 'B' }, now: later });
  assert.equal(d.stage, e.stage);
  assert.equal(d.note, e.note);
  assert.equal(d.status, e.status);
  assert.deepEqual(Object.keys(d).sort(), Object.keys(e).sort());
});

test('someone outside the pair sees nothing at all', () => {
  const i = intro({ a: verdict('recommend'), b: verdict('recommend') });
  assert.equal(viewFor(i, 'stranger', { now: NOW }), null);
});

test('waiting on the other person reveals nothing new about them', () => {
  const i = intro({ a: verdict('recommend'), b: verdict('recommend') });
  recordDecision(i, 'a', 'approve', { now: NOW });
  const forA = viewFor(i, 'a', { other: { displayName: 'B' }, screening: screening(), now: NOW });
  assert.equal(forA.stage, 'awaiting-them');
  assert.equal(forA.yourDecision, 'approve');
  assert.equal(JSON.stringify(forA).includes('approve'), true);
  assert.doesNotMatch(JSON.stringify(forA), /"decision":"approve","note":"","at":"[^"]*"}[^}]*"b"/);
});

test('pendingFor lists only what this person still has to decide', () => {
  const mine = intro({ a: verdict('recommend'), b: verdict('recommend') });
  const decided = { ...intro({ a: verdict('recommend'), b: verdict('recommend') }), id: 'i2' };
  recordDecision(decided, 'a', 'approve', { now: NOW });
  const theirs = { ...intro({ a: verdict('recommend'), b: verdict('recommend') }), id: 'i3', pairIds: ['c', 'd'] };
  assert.deepEqual(pendingFor([mine, decided, theirs], 'a', NOW).map((i) => i.id), ['i1']);
});

// --- end to end ------------------------------------------------------------

test('a full run screens, proposes, and waits for both people', async () => {
  const { store, a, b, done } = await screenedPair(NOW);
  assert.equal(done.length, 1);
  assert.equal(done[0].screening.turns.length, tuning.screening.maxTurns);
  assert.ok(done[0].introduction, 'a strong complementary pair should be introduced');

  const inbox = introductionsFor(store, a.id);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].stage, 'awaiting-you');
  assert.ok(inbox[0].transcript.length > 0);
  assert.ok(inbox[0].other.displayName, 'the owner should see who this is');
  assert.doesNotMatch(JSON.stringify(inbox[0]), new RegExp(`"${b.id}"[^}]*verdict`));

  await respondToIntroduction(store, inbox[0].id, a.id, 'approve', { now: NOW });
  assert.equal(introductionsFor(store, a.id)[0].stage, 'awaiting-them');
  await respondToIntroduction(store, inbox[0].id, b.id, 'approve', { now: NOW });

  const final = introductionsFor(store, a.id)[0];
  assert.equal(final.stage, 'introduced');
  assert.ok(final.firstStep.length > 0);
});

test('the same pair is not screened again after being introduced', async () => {
  const { store } = await screenedPair(NOW);
  assert.equal((await runScreenings(store, { now: NOW })).length, 0);
});

test('blocking after a screening keeps the pair apart on the next run', async () => {
  const { store, a, b } = await screenedPair(NOW);
  await blockMember(store, a.id, b.id);
  assert.equal((await runScreenings(store, { now: new Date(NOW.getTime() + 60 * DAY) })).length, 0);
});

test('expired introductions are swept rather than left in the inbox', async () => {
  const { store, a } = await screenedPair(NOW);
  const later = new Date(NOW.getTime() + (tuning.screening.approvalExpiryDays + 2) * DAY);
  assert.equal((await expireIntroductions(store, { now: later })).length, 1);
  assert.equal(introductionsFor(store, a.id, { now: later })[0].stage, 'closed');
});

test('the API refuses decisions from people who are not party to the introduction', async () => {
  const { store, a } = await screenedPair(new Date());
  const stranger = await joinMember(store, { displayName: 'Nosy' });
  const id = store.data.introductions[0].id;
  const call = (body) => handle(store, 'POST', `/api/introductions/${id}/respond`, body);

  assert.equal((await call({ memberId: stranger.id, decision: 'approve' })).status, 409);
  assert.equal((await call({ memberId: 'ghost', decision: 'approve' })).status, 400);
  assert.equal((await call({ memberId: a.id, decision: 'shrug' })).status, 400);
  assert.equal((await call({ memberId: a.id, decision: 'approve' })).status, 200);
  assert.equal((await call({ memberId: a.id, decision: 'approve' })).status, 409);
});

test('the API never serves one member another member’s inbox', async () => {
  const { store, a, b } = await screenedPair(new Date());
  const forA = await handle(store, 'GET', `/api/introductions/${a.id}`);
  const forB = await handle(store, 'GET', `/api/introductions/${b.id}`);
  assert.notEqual(forA.body[0].yourVerdict.headline ?? 'x', undefined);
  assert.equal(forA.body[0].other.id, b.id);
  assert.equal(forB.body[0].other.id, a.id);
  assert.equal((await handle(store, 'GET', '/api/introductions/ghost')).status, 404);
});
