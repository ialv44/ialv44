import test from 'node:test';
import assert from 'node:assert/strict';
import { formPods, findSpine, canAdd, chooseSeed, waitingReason } from '../src/core/pods.js';
import { tuning } from '../src/config.js';
import { member, slots, NOW, DAY } from './helpers.js';

function cohort(n, overrides = () => ({})) {
  return Array.from({ length: n }, (_, i) => member({ id: `c${i}`, displayName: `C${i}`, ...overrides(i) }));
}

test('a compatible cohort forms one pod within the size bounds', () => {
  const { pods, leftovers } = formPods(cohort(5), {}, NOW);
  assert.equal(pods.length, 1);
  assert.ok(pods[0].memberIds.length >= tuning.pod.minSize);
  assert.ok(pods[0].memberIds.length <= tuning.pod.maxSize);
  assert.equal(leftovers.length, 0);
});

test('a cohort below minimum size forms no pod and everyone is explained', () => {
  const { pods, leftovers } = formPods(cohort(3), {}, NOW);
  assert.equal(pods.length, 0);
  assert.equal(leftovers.length, 3);
  assert.ok(leftovers.every((l) => typeof l.reason.detail === 'string' && l.reason.detail.length));
});

test('eleven compatible people split into two pods rather than one oversized one', () => {
  const { pods } = formPods(cohort(11), {}, NOW);
  assert.equal(pods.length, 2);
  for (const p of pods) assert.ok(p.memberIds.length <= tuning.pod.maxSize);
});

test('nobody lands in two pods at once', () => {
  const { pods } = formPods(cohort(12), {}, NOW);
  const all = pods.flatMap((p) => p.memberIds);
  assert.equal(all.length, new Set(all).size);
});

test('every formed pod has a slot its quorum can actually make', () => {
  const { pods } = formPods(cohort(10, (i) => ({
    availability: i % 2 ? slots('tue:evening', 'sat:midday') : slots('tue:evening', 'thu:evening'),
  })), {}, NOW);
  for (const p of pods) {
    assert.ok(p.ritual, 'pod formed without a ritual');
    assert.ok(p.ritual.coverage * p.memberIds.length >= p.ritual.quorum);
  }
});

test('people who share no time with anyone are left over, not forced into a pod', () => {
  const pool = [...cohort(5), member({ id: 'owl', displayName: 'Owl', availability: slots('mon:late') })];
  const { pods, leftovers } = formPods(pool, {}, NOW);
  assert.ok(!pods.some((p) => p.memberIds.includes('owl')));
  assert.equal(leftovers[0].member.id, 'owl');
  assert.equal(leftovers[0].reason.code, 'no-shared-time');
});

test('blocked members are never placed together', () => {
  const pool = cohort(6);
  const opts = { blocks: [{ by: 'c0', target: 'c1' }] };
  const { pods } = formPods(pool, opts, NOW);
  for (const p of pods) {
    assert.ok(!(p.memberIds.includes('c0') && p.memberIds.includes('c1')));
  }
});

test('an anchor is preferred when one is available', () => {
  const pool = [
    ...cohort(4, () => ({ arrivedAt: new Date(NOW - 30 * DAY).toISOString().slice(0, 10) })),
    member({ id: 'anchor', displayName: 'Anchor', arrivedAt: '2019-01-01' }),
  ];
  const { pods } = formPods(pool, {}, NOW);
  assert.equal(pods.length, 1);
  assert.ok(pods[0].memberIds.includes('anchor'));
  assert.ok(!pods[0].warnings.includes('no-anchor'));
});

test('a pod with no long-term resident is flagged rather than silently shipped', () => {
  const pool = cohort(5, () => ({ arrivedAt: new Date(NOW - 20 * DAY).toISOString().slice(0, 10) }));
  const { pods } = formPods(pool, {}, NOW);
  assert.ok(pods[0].warnings.includes('no-anchor'));
});

test('the strictest group-size constraint in a pod is respected', () => {
  const pool = cohort(8, (i) => (i === 0 ? { constraints: { maxGroupSize: 4 } } : {}));
  const { pods } = formPods(pool, {}, NOW);
  const theirs = pods.find((p) => p.memberIds.includes('c0'));
  assert.ok(theirs.memberIds.length <= 4);
});

test('the longest-waiting member is seeded first', () => {
  const pool = [
    member({ id: 'new', joinedAt: new Date(NOW - 1 * DAY).toISOString() }),
    member({ id: 'old', joinedAt: new Date(NOW - 90 * DAY).toISOString() }),
    member({ id: 'mid', joinedAt: new Date(NOW - 30 * DAY).toISOString() }),
  ];
  assert.equal(chooseSeed(pool, {}, NOW).id, 'old');
});

test('findSpine reports the interest most of the pod shares', () => {
  const pool = [
    member({ interests: ['running', 'film'] }),
    member({ interests: ['running'] }),
    member({ interests: ['running', 'chess'] }),
    member({ interests: ['chess'] }),
  ];
  assert.deepEqual(findSpine(pool), { tag: 'running', count: 3 });
});

test('canAdd refuses a candidate who would break the pod quorum', () => {
  const pod = [
    member({ availability: slots('tue:evening') }),
    member({ availability: slots('tue:evening') }),
    member({ availability: slots('tue:evening') }),
  ];
  const owl = member({ availability: slots('mon:late') });
  assert.equal(canAdd(owl, pod).ok, false);
});

test('waitingReason distinguishes a thin city from an incompatible one', () => {
  const pool = cohort(3);
  assert.equal(waitingReason(pool[0], pool, {}).code, 'too-few-people');
  const alone = member({ id: 'solo', city: 'Reykjavik' });
  assert.equal(waitingReason(alone, [alone, ...pool], {}).code, 'different-city');
});

test('someone whose matches are all already in pods is told exactly that', () => {
  const pool = cohort(5);
  const { pods } = formPods(pool, {}, NOW);
  const placed = new Set(pods[0].memberIds);
  const latecomer = member({ id: 'late', joinedAt: new Date(NOW - 1 * DAY).toISOString() });

  const reason = waitingReason(latecomer, [...pool, latecomer], {
    available: [latecomer, ...pool.filter((m) => !placed.has(m.id))],
  });
  assert.equal(reason.code, 'all-matched');
  assert.ok(reason.viableAnywhere >= 4);
  assert.match(reason.detail, /already in pods/);
});

test('an incompatible person is not told their matches are merely busy', () => {
  const pool = cohort(5);
  const owl = member({ id: 'owl', availability: slots('mon:late') });
  const reason = waitingReason(owl, [...pool, owl], { available: [owl] });
  assert.equal(reason.code, 'no-shared-time');
});

test('pod formation is deterministic for the same input', () => {
  const pool = cohort(9, (i) => ({ interests: i % 3 ? ['running'] : ['chess', 'running'] }));
  const a = formPods(pool, {}, NOW).pods.map((p) => p.memberIds.join(','));
  const b = formPods(pool, {}, NOW).pods.map((p) => p.memberIds.join(','));
  assert.deepEqual(a, b);
});
