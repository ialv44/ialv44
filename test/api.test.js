import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { Store } from '../src/store.js';
import { handle } from '../src/api.js';
import { joinMember, chatTurn, blockMember, recordMeetup, memberView, explainPair } from '../src/service.js';
import { publicView, normalizeProfile } from '../src/core/profile.js';
import { member, slots } from './helpers.js';

async function tmpStore() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'thirdplace-'));
  return Store.open(path.join(dir, 'db.json'));
}

const call = (store, method, url, body) => {
  const u = new URL(url, 'http://x');
  return handle(store, method, u.pathname, body, Object.fromEntries(u.searchParams));
};

test('joining returns a normalised profile and appears in the roster', async () => {
  const store = await tmpStore();
  const res = await call(store, 'POST', '/api/members', {
    displayName: 'Ana', city: 'Lisbon', languages: ['PT'], availability: [{ day: 'TUE', window: 'Evening' }],
  });
  assert.equal(res.status, 201);
  assert.match(res.body.id, /^mem_/);
  assert.deepEqual(res.body.languages, [{ code: 'pt', level: 'fluent' }]);

  const list = await call(store, 'GET', '/api/members');
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].podId, null);
});

test('joining without a name is rejected', async () => {
  const store = await tmpStore();
  assert.equal((await call(store, 'POST', '/api/members', { city: 'Lisbon' })).status, 400);
});

test('a GET route does not shadow the POST on the same path', async () => {
  const store = await tmpStore();
  assert.equal((await call(store, 'POST', '/api/members', { displayName: 'Ana' })).status, 201);
  assert.equal((await call(store, 'DELETE', '/api/members')).status, 405);
  assert.equal((await call(store, 'GET', '/api/nowhere')).status, 404);
});

test('unknown members give 404, not 500', async () => {
  const store = await tmpStore();
  assert.equal((await call(store, 'GET', '/api/members/nope')).status, 404);
  assert.equal((await call(store, 'GET', '/api/pods/nope')).status, 404);
  assert.equal((await call(store, 'POST', '/api/members/nope/chat', { text: 'hi' })).status, 404);
});

test('the demo endpoint produces pods, meet-ups and nudges', async () => {
  const store = await tmpStore();
  const res = await call(store, 'POST', '/api/demo');
  assert.equal(res.status, 201);
  assert.ok(res.body.pods >= 1);
  assert.ok(res.body.pendingNudges > 0);

  const pods = await call(store, 'GET', '/api/pods');
  assert.ok(pods.body[0].ritual.day);
  assert.ok(pods.body[0].members.length >= 4);
  assert.ok(pods.body[0].nextAt > new Date().toISOString());
});

test('joining opens the conversation instead of waiting silently', async () => {
  const store = await tmpStore();
  const m = await joinMember(store, { displayName: '', city: '' });
  assert.equal(m.onboarding.awaiting, 'displayName');
  assert.match(m.onboarding.transcript[0].text, /call you/i);
});

test('the first answer is attached to the opening question, not discarded', async () => {
  const store = await tmpStore();
  const m = await joinMember(store, { displayName: '', city: '' });
  await chatTurn(store, m.id, 'Ana');
  assert.equal(store.member(m.id).displayName, 'Ana');
});

test('an answer the agent cannot read is re-asked in different words', async () => {
  const store = await tmpStore();
  const m = await joinMember(store, { displayName: 'Ana', city: 'Lisbon' });
  assert.equal(store.member(m.id).onboarding.awaiting, 'arrivedAt');

  const question = m.onboarding.transcript.at(-1).text;
  const first = await chatTurn(store, m.id, 'ages ago, who remembers');
  assert.notEqual(first.reply, question, 'repeated the identical question');
  assert.match(first.reply, /date/i);
  assert.equal(store.member(m.id).onboarding.awaiting, 'arrivedAt');

  // Still stuck on the same field, still not pretending it understood.
  const second = await chatTurn(store, m.id, 'honestly no idea');
  assert.notEqual(second.reply, question);
  assert.equal(store.member(m.id).arrivedAt, null);

  // And it recovers as soon as a readable answer arrives.
  await chatTurn(store, m.id, 'March 2024');
  assert.equal(store.member(m.id).arrivedAt, '2024-03-01');
  assert.notEqual(store.member(m.id).onboarding.awaiting, 'arrivedAt');
});

test('the onboarding conversation fills the profile turn by turn', async () => {
  const store = await tmpStore();
  const m = await joinMember(store, { displayName: 'Ana' });
  await chatTurn(store, m.id, 'Lisbon');
  assert.equal(store.member(m.id).city, 'Lisbon');

  await chatTurn(store, m.id, '8 months ago');
  assert.ok(store.member(m.id).arrivedAt);

  await chatTurn(store, m.id, 'native Portuguese and fluent English');
  assert.deepEqual(store.member(m.id).languages.map((l) => l.code).sort(), ['en', 'pt']);

  const avail = await chatTurn(store, m.id, 'Tuesday evenings and Saturday mornings');
  assert.deepEqual(
    store.member(m.id).availability.map((a) => `${a.day}:${a.window}`).sort(),
    ['sat:morning', 'tue:evening'],
  );
  assert.equal(avail.ready, true);
});

test('recording a meet-up ignores attendees who are not in the pod', async () => {
  const store = await tmpStore();
  await call(store, 'POST', '/api/demo');
  const pod = store.data.pods[0];
  const meetup = await recordMeetup(store, {
    podId: pod.id,
    at: new Date().toISOString(),
    attendedIds: [...pod.memberIds.slice(0, 3), 'mem_stranger'],
  });
  assert.equal(meetup.attendedIds.length, 3);
  assert.ok(!meetup.attendedIds.includes('mem_stranger'));
  assert.equal(meetup.quorumMet, true);
});

test('blocking someone dissolves the pod they shared and frees both to rematch', async () => {
  const store = await tmpStore();
  await call(store, 'POST', '/api/demo');
  const pod = store.data.pods.find((p) => p.status === 'active');
  const [a, b] = pod.memberIds;

  await blockMember(store, a, b);
  assert.equal(store.pod(pod.id).status, 'dissolved');
  assert.equal(store.podOf(a), null);
  assert.ok(store.unpodded().some((m) => m.id === a));

  // And they are never put back together.
  const again = await call(store, 'POST', '/api/match');
  for (const p of again.body.created) {
    assert.ok(!(p.memberIds.includes(a) && p.memberIds.includes(b)));
  }
});

test('reporting someone also blocks them', async () => {
  const store = await tmpStore();
  await call(store, 'POST', '/api/demo');
  const pod = store.data.pods.find((p) => p.status === 'active');
  const [a, b] = pod.memberIds;
  const res = await call(store, 'POST', '/api/reports', { by: a, target: b, reason: 'made me uncomfortable' });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'open');
  assert.ok(store.data.blocks.some((x) => x.by === a && x.target === b));
});

test('the public view never leaks a private field', async () => {
  const m = normalizeProfile({
    ...member({ displayName: 'Ana', neighborhood: 'Graça' }),
    consent: { shareCity: false, shareLanguages: false, open1on1: false },
  });
  const view = publicView(m);
  assert.equal(view.city, null);
  assert.equal(view.neighborhood, null);
  assert.deepEqual(view.languages, []);
  assert.equal(view.onboarding, undefined);
  assert.equal(view.joinedAt, undefined);
  assert.equal(view.constraints, undefined);
  assert.equal(view.consent, undefined);
});

test('a member sees their own hidden fields', () => {
  const m = member({ consent: { shareCity: false } });
  assert.equal(publicView(m, m).city, 'Lisbon');
});

test('pair explanation reports both the fit and the shared history', async () => {
  const store = await tmpStore();
  await call(store, 'POST', '/api/demo');
  const pod = store.data.pods[0];
  const [a, b] = pod.memberIds;
  const res = await call(store, 'GET', `/api/pairs/${a}/${b}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.compat.score > 0);
  assert.ok(Array.isArray(res.body.compat.evidence.sharedInterests));
  assert.ok(res.body.warmth.counts['co-attend'] >= 0);
});

test('nudges can be filtered and resolved', async () => {
  const store = await tmpStore();
  await call(store, 'POST', '/api/demo');
  const pending = await call(store, 'GET', '/api/nudges?status=pending');
  assert.ok(pending.body.length > 0);

  const target = pending.body[0];
  const resolved = await call(store, 'POST', `/api/nudges/${target.id}/resolve`, { status: 'dismissed' });
  assert.equal(resolved.body.status, 'dismissed');
  assert.equal((await call(store, 'GET', '/api/nudges?status=pending')).body.length, pending.body.length - 1);
});

test('a member view carries their pod, or the reason they have none', async () => {
  const store = await tmpStore();
  await call(store, 'POST', '/api/demo');
  const podded = store.data.pods[0].memberIds[0];
  const waiting = store.unpodded()[0];

  assert.ok(memberView(store, podded).pod.ritual);
  assert.equal(memberView(store, podded).waiting, null);
  assert.equal(memberView(store, waiting.id).pod, null);
  assert.ok(memberView(store, waiting.id).waiting.detail.length > 0);
});

test('the store survives a reload', async () => {
  const store = await tmpStore();
  await call(store, 'POST', '/api/demo');
  const reopened = await Store.open(store.filePath);
  assert.equal(reopened.data.members.length, store.data.members.length);
  assert.equal(reopened.data.pods.length, store.data.pods.length);
});

test('concurrent writes do not lose members', async () => {
  const store = await tmpStore();
  await Promise.all(
    Array.from({ length: 12 }, (_, i) => joinMember(store, { displayName: `P${i}`, city: 'Lisbon' })),
  );
  assert.equal(store.data.members.length, 12);
  assert.equal((await Store.open(store.filePath)).data.members.length, 12);
});

test('members with only late-night availability are explained, not matched', async () => {
  const store = await tmpStore();
  for (let i = 0; i < 4; i += 1) {
    await joinMember(store, { ...member({ availability: slots('tue:evening') }), displayName: `Day${i}` });
  }
  const owl = await joinMember(store, { ...member({ availability: slots('mon:late') }), displayName: 'Owl' });
  await call(store, 'POST', '/api/match');
  const view = memberView(store, owl.id);
  assert.equal(view.pod, null);
  assert.equal(view.waiting.code, 'no-shared-time');
});
