import test from 'node:test';
import assert from 'node:assert/strict';
import { detectNudges } from '../src/core/nudges.js';
import { Store } from '../src/store.js';
import { tuning } from '../src/config.js';
import { member, daysAgo, NOW, DAY } from './helpers.js';

function storeWith(patch = {}) {
  const s = new Store('/dev/null');
  Object.assign(s.data, patch);
  return s;
}

const kinds = (list) => list.map((n) => n.kind);

test('someone who joined this week gets orientation, not an apology', () => {
  const m = member({ joinedAt: daysAgo(2) });
  const found = detectNudges(storeWith({ members: [m] }), { now: NOW });
  assert.ok(kinds(found).includes('newcomer-orientation'));
  assert.ok(!kinds(found).includes('still-waiting'));
});

test('someone still unmatched after the first week gets the real reason', () => {
  const m = member({ joinedAt: daysAgo(30) });
  const found = detectNudges(storeWith({ members: [m] }), { now: NOW });
  const n = found.find((x) => x.kind === 'still-waiting');
  assert.ok(n);
  assert.equal(typeof n.facts.detail, 'string');
  assert.equal(n.facts.daysWaiting, 30);
});

test('a new pod is welcomed exactly once', () => {
  const members = Array.from({ length: 4 }, (_, i) => member({ id: `m${i}` }));
  const pod = {
    id: 'p1', memberIds: members.map((m) => m.id), status: 'active',
    createdAt: daysAgo(1), welcomedAt: null, warnings: [], ritual: null, spine: null,
  };
  const s = storeWith({ members, pods: [pod] });
  assert.ok(kinds(detectNudges(s, { now: NOW })).includes('pod-welcome'));

  pod.welcomedAt = daysAgo(1);
  assert.ok(!kinds(detectNudges(s, { now: NOW })).includes('pod-welcome'));
});

test('a pending nudge of the same kind is never queued twice', () => {
  const m = member({ joinedAt: daysAgo(2) });
  const s = storeWith({ members: [m] });
  const first = detectNudges(s, { now: NOW });
  s.data.nudges.push({ ...first[0], id: 'n1', status: 'pending', createdAt: NOW.toISOString() });
  assert.equal(detectNudges(s, { now: NOW }).length, 0);
});

test('a sent nudge is suppressed during its cooldown and allowed after', () => {
  const m = member({ joinedAt: daysAgo(2) });
  const s = storeWith({ members: [m] });
  const first = detectNudges(s, { now: NOW })[0];

  s.data.nudges.push({ ...first, id: 'n1', status: 'sent', createdAt: daysAgo(1) });
  assert.equal(detectNudges(s, { now: NOW }).length, 0);

  s.data.nudges[0].createdAt = daysAgo(tuning.nudges.cooldownDays + 1);
  assert.ok(detectNudges(s, { now: NOW }).length > 0);
});

test('a pod with no long-term resident is told so', () => {
  const members = Array.from({ length: 4 }, (_, i) => member({ id: `m${i}` }));
  const pod = {
    id: 'p1', memberIds: members.map((m) => m.id), status: 'active',
    createdAt: daysAgo(1), welcomedAt: daysAgo(1), warnings: ['no-anchor'], ritual: null, spine: null,
  };
  assert.ok(kinds(detectNudges(storeWith({ members, pods: [pod] }), { now: NOW })).includes('pod-gap'));
});

test('a reminder fires the day before the ritual, not a week out', () => {
  const members = Array.from({ length: 4 }, (_, i) => member({ id: `m${i}` }));
  const ritual = { day: 'tue', window: 'evening', cadence: 'weekly', quorum: 3, venue: { label: 'a cafe' } };
  const pod = {
    id: 'p1', memberIds: members.map((m) => m.id), status: 'active',
    createdAt: daysAgo(30), welcomedAt: daysAgo(30), warnings: [], ritual, spine: null,
  };
  const s = storeWith({ members, pods: [pod] });

  const dayBefore = new Date('2026-06-15T19:00:00Z'); // Monday evening
  assert.ok(kinds(detectNudges(s, { now: dayBefore })).includes('pre-meetup'));

  const weekBefore = new Date('2026-06-09T19:00:00Z');
  assert.ok(!kinds(detectNudges(s, { now: weekBefore })).includes('pre-meetup'));
});

test('a quiet pod is checked in on, and a dead one is offered a way out', () => {
  const members = Array.from({ length: 4 }, (_, i) => member({ id: `m${i}` }));
  const base = {
    id: 'p1', memberIds: members.map((m) => m.id), status: 'active',
    createdAt: daysAgo(90), welcomedAt: daysAgo(90), warnings: [], ritual: { quorum: 3, alternates: [] }, spine: null,
  };
  const ids = members.map((m) => m.id);

  const quiet = storeWith({
    members, pods: [base],
    meetups: [{ id: 'x', podId: 'p1', at: daysAgo(25), attendedIds: ids }],
  });
  assert.ok(kinds(detectNudges(quiet, { now: NOW })).includes('drift-checkin'));

  const dead = storeWith({
    members, pods: [base],
    meetups: [{ id: 'x', podId: 'p1', at: daysAgo(50), attendedIds: ids }],
  });
  assert.ok(kinds(detectNudges(dead, { now: NOW })).includes('reshuffle-offer'));
});

test('a member drifting out of a live pod is asked about the time, once', () => {
  const members = Array.from({ length: 4 }, (_, i) => member({ id: `m${i}` }));
  const pod = {
    id: 'p1', memberIds: members.map((m) => m.id), status: 'active',
    createdAt: daysAgo(60), welcomedAt: daysAgo(60), warnings: [], ritual: { quorum: 3 }, spine: null,
  };
  const others = ['m1', 'm2', 'm3'];
  const s = storeWith({
    members, pods: [pod],
    meetups: [
      { id: 'a', podId: 'p1', at: daysAgo(21), attendedIds: ['m0', ...others] },
      { id: 'b', podId: 'p1', at: daysAgo(14), attendedIds: others },
      { id: 'c', podId: 'p1', at: daysAgo(7), attendedIds: others },
    ],
  });
  const found = detectNudges(s, { now: NOW }).filter((n) => n.kind === 'no-show-recovery');
  assert.equal(found.length, 1);
  assert.equal(found[0].memberId, 'm0');
});

test('only the warmest pair in a pod is nudged towards a coffee', () => {
  const members = Array.from({ length: 4 }, (_, i) => member({ id: `m${i}` }));
  const ids = members.map((m) => m.id);
  const pod = {
    id: 'p1', memberIds: ids, status: 'active',
    createdAt: daysAgo(60), welcomedAt: daysAgo(60), warnings: [], ritual: { quorum: 3 }, spine: null,
  };
  const s = storeWith({
    members, pods: [pod],
    meetups: [3, 10, 17, 24].map((d) => ({ id: `m${d}`, podId: 'p1', at: daysAgo(d), attendedIds: ids })),
  });
  const found = detectNudges(s, { now: NOW }).filter((n) => n.kind === 'first-1on1');
  assert.equal(found.length, 1);
  assert.ok(found[0].facts.alsoEligible > 0);
});

test('a milestone in the city fires in its window and not outside it', () => {
  const at = (days) => member({ arrivedAt: new Date(NOW - days * DAY).toISOString().slice(0, 10), joinedAt: daysAgo(2) });
  const fired = detectNudges(storeWith({ members: [at(91)] }), { now: NOW });
  assert.ok(kinds(fired).includes('arrival-milestone'));
  const notYet = detectNudges(storeWith({ members: [at(80)] }), { now: NOW });
  assert.ok(!kinds(notYet).includes('arrival-milestone'));
  const longPast = detectNudges(storeWith({ members: [at(200)] }), { now: NOW });
  assert.ok(!kinds(longPast).includes('arrival-milestone'));
});

test('dissolved pods generate nothing', () => {
  const members = Array.from({ length: 4 }, (_, i) => member({ id: `m${i}` }));
  const pod = {
    id: 'p1', memberIds: members.map((m) => m.id), status: 'dissolved',
    createdAt: daysAgo(90), welcomedAt: null, warnings: ['no-anchor'], ritual: null, spine: null,
  };
  const found = detectNudges(storeWith({ members, pods: [pod] }), { now: NOW });
  assert.equal(found.filter((n) => n.podId === 'p1').length, 0);
});

test('a dissolved pod releases its members back into the waiting pool', () => {
  const members = Array.from({ length: 4 }, (_, i) => member({ id: `m${i}`, joinedAt: daysAgo(30) }));
  const pod = {
    id: 'p1', memberIds: members.map((m) => m.id), status: 'dissolved',
    createdAt: daysAgo(90), welcomedAt: daysAgo(90), warnings: [], ritual: null, spine: null,
  };
  const s = storeWith({ members, pods: [pod] });
  assert.equal(s.unpodded().length, 4);
  assert.equal(detectNudges(s, { now: NOW }).filter((n) => n.kind === 'still-waiting').length, 4);
});
