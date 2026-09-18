import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRitual, rankedSlots, quorumFor, nextOccurrence, venueArchetype, slotAppeal } from '../src/core/rituals.js';
import { member, slots, NOW } from './helpers.js';

test('quorum is never below three and scales with pod size', () => {
  assert.equal(quorumFor(4), 3);
  assert.equal(quorumFor(5), 3);
  assert.equal(quorumFor(6), 4);
});

test('the ritual picks the slot most of the pod can make', () => {
  const pod = [
    member({ availability: slots('tue:evening', 'fri:evening') }),
    member({ availability: slots('tue:evening') }),
    member({ availability: slots('tue:evening', 'fri:evening') }),
    member({ availability: slots('tue:evening') }),
  ];
  const r = buildRitual(pod, { now: NOW });
  assert.equal(r.day, 'tue');
  assert.equal(r.window, 'evening');
  assert.equal(r.coverage, 1);
});

test('coverage beats convenience, but convenience breaks ties', () => {
  // Every member is free both times, so only slot appeal separates them.
  const pod = Array.from({ length: 4 }, () => member({ availability: slots('fri:evening', 'tue:evening') }));
  assert.equal(buildRitual(pod, { now: NOW }).day, 'tue');
  assert.ok(slotAppeal('tue:evening') > slotAppeal('fri:evening'));
});

test('a slot only a minority can make is not offered', () => {
  const pod = [
    member({ availability: slots('tue:evening', 'mon:late') }),
    member({ availability: slots('tue:evening') }),
    member({ availability: slots('tue:evening') }),
    member({ availability: slots('tue:evening') }),
  ];
  const offered = rankedSlots(pod).map((s) => s.slot);
  assert.ok(offered.includes('tue:evening'));
  assert.ok(!offered.includes('mon:late'));
});

test('a pod with no shared slot gets no ritual at all', () => {
  const pod = [
    member({ availability: slots('mon:morning') }),
    member({ availability: slots('tue:midday') }),
    member({ availability: slots('wed:evening') }),
    member({ availability: slots('thu:late') }),
  ];
  assert.equal(buildRitual(pod, { now: NOW }), null);
});

test('the next occurrence is always in the future and on the right weekday', () => {
  const from = new Date('2026-06-10T12:00:00Z'); // Wednesday
  const next = nextOccurrence({ day: 'tue', window: 'evening', cadence: 'weekly' }, from);
  assert.ok(next > from);
  assert.equal(next.getDay(), 2);
  assert.equal(next.toISOString().slice(0, 10), '2026-06-16');
});

test('a slot later the same day still counts as today', () => {
  const morningOf = new Date('2026-06-16T06:00:00Z'); // Tuesday, before 18:30
  const next = nextOccurrence({ day: 'tue', window: 'evening', cadence: 'weekly' }, morningOf);
  assert.equal(next.toISOString().slice(0, 10), '2026-06-16');
});

test('a slot that has already passed today rolls to next week', () => {
  const eveningOf = new Date('2026-06-16T20:00:00Z'); // Tuesday, after 18:30
  const next = nextOccurrence({ day: 'tue', window: 'evening', cadence: 'weekly' }, eveningOf);
  assert.equal(next.toISOString().slice(0, 10), '2026-06-23');
});

test('biweekly skips a fortnight rather than a week', () => {
  const eveningOf = new Date('2026-06-16T20:00:00Z');
  const next = nextOccurrence({ day: 'tue', window: 'evening', cadence: 'biweekly' }, eveningOf);
  assert.equal(next.toISOString().slice(0, 10), '2026-06-30');
});

test('the venue follows the interest most of the pod shares, not the first one listed', () => {
  const pod = [
    member({ interests: ['hiking', 'cooking'] }),
    member({ interests: ['cooking', 'food'] }),
    member({ interests: ['cooking'] }),
    member({ interests: ['cooking', 'baking'] }),
  ];
  assert.match(venueArchetype(pod).label, /market/);
});

test('one outlier interest does not choose the venue for everyone', () => {
  const pod = [
    member({ interests: ['climbing'] }),
    member({ interests: ['knitting'] }),
    member({ interests: ['gardening'] }),
    member({ interests: ['birdwatching'] }),
  ];
  assert.doesNotMatch(venueArchetype(pod).label, /bouldering/);
});

test('one sober or low-budget member steers the whole pod somewhere that works', () => {
  const pod = [
    member({ interests: ['knitting'], constraints: { alcoholFree: true } }),
    member({ interests: ['gardening'] }),
    member({ interests: ['birdwatching'] }),
    member({ interests: ['philately'] }),
  ];
  const v = venueArchetype(pod);
  assert.equal(v.alcoholFree, true);
  assert.match(v.label, /cafe/);
});

test('no venue archetype sends strangers to a private home', () => {
  const combos = [['running'], ['cooking'], ['chess'], ['film'], ['climbing'], ['unmapped']];
  for (const tags of combos) {
    const pod = Array.from({ length: 4 }, () => member({ interests: tags }));
    assert.doesNotMatch(venueArchetype(pod).label, /home|someone'?s place|apartment|flat/i);
  }
});
