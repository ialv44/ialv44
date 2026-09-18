import test from 'node:test';
import assert from 'node:assert/strict';
import { pairWarmth, podMomentum, decay, readyForOneOnOne, missedInARow, warmthMap, deriveInteractions } from '../src/core/momentum.js';
import { tuning } from '../src/config.js';
import { member, daysAgo, NOW } from './helpers.js';

const pod = (memberIds, extra = {}) => ({
  id: 'p1', memberIds, ritual: { quorum: 3 }, createdAt: daysAgo(60), status: 'active', ...extra,
});

const meetup = (at, attendedIds) => ({ id: `m${at}`, podId: 'p1', at, attendedIds });

test('warmth halves over one half-life', () => {
  assert.equal(decay(0), 1);
  assert.ok(Math.abs(decay(tuning.momentum.halfLifeDays) - 0.5) < 1e-9);
  assert.ok(decay(tuning.momentum.halfLifeDays * 2) < 0.26);
});

test('recent shared meet-ups outweigh older ones', () => {
  const recent = pairWarmth('a', 'b', { meetups: [meetup(daysAgo(2), ['a', 'b'])], now: NOW });
  const stale = pairWarmth('a', 'b', { meetups: [meetup(daysAgo(120), ['a', 'b'])], now: NOW });
  assert.ok(recent.score > stale.score * 5);
});

test('a one-to-one counts for more than a group meet-up', () => {
  const group = pairWarmth('a', 'b', { meetups: [meetup(daysAgo(1), ['a', 'b'])], now: NOW });
  const solo = pairWarmth('a', 'b', { interactions: [{ kind: 'one-on-one', a: 'a', b: 'b', at: daysAgo(1) }], now: NOW });
  assert.ok(solo.score > group.score);
});

test('warmth counts only the pair asked about', () => {
  const w = pairWarmth('a', 'b', { meetups: [meetup(daysAgo(1), ['a', 'c'])], now: NOW });
  assert.equal(w.score, 0);
  assert.equal(w.counts['co-attend'], 0);
});

test('pair order does not change the result', () => {
  const ctx = { meetups: [meetup(daysAgo(3), ['a', 'b'])], now: NOW };
  assert.deepEqual(pairWarmth('a', 'b', ctx), pairWarmth('b', 'a', ctx));
});

test('a meet-up of four produces six co-attendance edges', () => {
  assert.equal(deriveInteractions([meetup(daysAgo(1), ['a', 'b', 'c', 'd'])]).length, 6);
});

test('a pod meeting weekly reads as warm', () => {
  const p = pod(['a', 'b', 'c', 'd']);
  const meetups = [7, 14, 21, 28].map((d) => meetup(daysAgo(d), ['a', 'b', 'c', 'd']));
  const m = podMomentum(p, { meetups, now: NOW });
  assert.equal(m.state, 'warm');
  assert.equal(m.held, 4);
  assert.equal(m.daysSinceLast, 7);
});

test('a pod quiet for three weeks reads as cooling, and six as cold', () => {
  const p = pod(['a', 'b', 'c', 'd']);
  const cooling = podMomentum(p, { meetups: [meetup(daysAgo(25), ['a', 'b', 'c'])], now: NOW });
  const cold = podMomentum(p, { meetups: [meetup(daysAgo(50), ['a', 'b', 'c'])], now: NOW });
  assert.equal(cooling.state, 'cooling');
  assert.equal(cold.state, 'cold');
});

test('a brand new pod is forming, not stalled', () => {
  const p = pod(['a', 'b', 'c', 'd'], { createdAt: daysAgo(3) });
  assert.equal(podMomentum(p, { meetups: [], now: NOW }).state, 'forming');
});

test('a pod that never met and is no longer new is stalled', () => {
  const p = pod(['a', 'b', 'c', 'd'], { createdAt: daysAgo(40) });
  assert.equal(podMomentum(p, { meetups: [], now: NOW }).state, 'stalled');
});

test('meet-ups in the future do not count towards momentum', () => {
  const p = pod(['a', 'b', 'c', 'd']);
  const future = new Date(NOW.getTime() + 3 * 86400000).toISOString();
  assert.equal(podMomentum(p, { meetups: [meetup(future, ['a', 'b', 'c'])], now: NOW }).held, 0);
});

test('consecutive absences are counted from the most recent meet-up backwards', () => {
  const meetups = [
    meetup(daysAgo(28), ['a', 'b', 'c']),
    meetup(daysAgo(21), ['b', 'c']),
    meetup(daysAgo(14), ['b', 'c']),
  ];
  assert.equal(missedInARow('a', 'p1', meetups, NOW), 2);
  assert.equal(missedInARow('b', 'p1', meetups, NOW), 0);
});

test('showing up again resets the absence count', () => {
  const meetups = [
    meetup(daysAgo(28), ['b', 'c']),
    meetup(daysAgo(21), ['b', 'c']),
    meetup(daysAgo(14), ['a', 'b', 'c']),
  ];
  assert.equal(missedInARow('a', 'p1', meetups, NOW), 0);
});

test('a one-to-one is suggested only after enough shared rooms', () => {
  const a = member({ id: 'a' });
  const b = member({ id: 'b' });
  const few = pairWarmth('a', 'b', { meetups: [meetup(daysAgo(2), ['a', 'b'])], now: NOW });
  const many = pairWarmth('a', 'b', {
    meetups: [3, 10, 17, 24].map((d) => meetup(daysAgo(d), ['a', 'b'])),
    now: NOW,
  });
  assert.equal(readyForOneOnOne(few, a, b), false);
  assert.equal(readyForOneOnOne(many, a, b), true);
});

test('a member who opted out of one-to-ones is never suggested one', () => {
  const a = member({ id: 'a' });
  const shy = member({ id: 'b', consent: { open1on1: false } });
  const many = pairWarmth('a', 'b', {
    meetups: [3, 10, 17, 24].map((d) => meetup(daysAgo(d), ['a', 'b'])),
    now: NOW,
  });
  assert.equal(readyForOneOnOne(many, a, shy), false);
});

test('a pair who already met one-to-one is not nudged again', () => {
  const a = member({ id: 'a' });
  const b = member({ id: 'b' });
  const w = pairWarmth('a', 'b', {
    meetups: [3, 10, 17, 24].map((d) => meetup(daysAgo(d), ['a', 'b'])),
    interactions: [{ kind: 'one-on-one', a: 'a', b: 'b', at: daysAgo(5) }],
    now: NOW,
  });
  assert.equal(readyForOneOnOne(w, a, b), false);
});

test('the warmth map is sorted warmest first', () => {
  const meetups = [meetup(daysAgo(2), ['a', 'b']), meetup(daysAgo(90), ['a', 'c'])];
  const map = warmthMap(['a', 'b', 'c'], { meetups, now: NOW });
  assert.deepEqual(map[0].pair, ['a', 'b']);
  assert.ok(map[0].score >= map[map.length - 1].score);
});
