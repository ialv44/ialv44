import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eligiblePairs, openScreening, nextSpeaker, isComplete, currentTopic, topicIndex,
  lastMessageTo, intentReadiness, readinessGaps, unknownsFor,
} from '../src/core/screening.js';
import { intentFit } from '../src/core/intents.js';
import { Store } from '../src/store.js';
import { tuning } from '../src/config.js';
import { member, slots, daysAgo, NOW } from './helpers.js';

const CO = {
  commitment: 'full-time', stage: 'prototype', timeline: 'now', domains: ['climate'],
  brings: ['engineering'], needs: ['sales'], equityStance: 'equal', runwayMonths: 12, priorFounder: false,
};
const CO2 = { ...CO, brings: ['sales'], needs: ['engineering'] };

function storeWith(members, extra = {}) {
  const s = new Store('/dev/null');
  Object.assign(s.data, { members, ...extra });
  return s;
}

const cofounders = () => [
  member({ id: 'a', displayName: 'A', intents: ['cofounder'], intentProfiles: { cofounder: CO } }),
  member({ id: 'b', displayName: 'B', intents: ['cofounder'], intentProfiles: { cofounder: CO2 } }),
];

const names = (list) => list.map((c) => `${c.pairIds.join('+')}:${c.intent}`);

// --- readiness -------------------------------------------------------------

test('readiness measures how much of the intent questionnaire is answered', () => {
  const full = member({ intents: ['cofounder'], intentProfiles: { cofounder: CO } });
  const half = member({ intents: ['cofounder'], intentProfiles: { cofounder: { commitment: 'full-time' } } });
  assert.equal(intentReadiness(full, 'cofounder'), 1);
  assert.ok(intentReadiness(half, 'cofounder') < 0.3);
  assert.ok(readinessGaps(half, 'cofounder').includes('needs'));
});

test('the friend intent is ready off the base profile, since it has no questionnaire', () => {
  assert.equal(intentReadiness(member(), 'friend'), 1);
  assert.deepEqual(readinessGaps(member(), 'friend'), []);
});

// --- eligibility -----------------------------------------------------------

test('a viable, ready, well-matched pair is queued for screening', () => {
  const found = eligiblePairs(storeWith(cofounders()), { now: NOW });
  assert.deepEqual(names(found), ['a+b:cofounder']);
});

test('a gated pair is never screened, so no model is ever called for it', () => {
  const [a] = cofounders();
  const weekend = member({ id: 'b', intents: ['cofounder'], intentProfiles: { cofounder: { ...CO2, commitment: 'nights-weekends' } } });
  assert.deepEqual(eligiblePairs(storeWith([a, weekend]), { now: NOW }), []);
});

test('a pair nobody has filled in for is not screened', () => {
  const [a] = cofounders();
  const blank = member({ id: 'b', intents: ['cofounder'], intentProfiles: { cofounder: { commitment: 'full-time' } } });
  assert.deepEqual(eligiblePairs(storeWith([a, blank]), { now: NOW }), []);
});

test('a weak match is not worth a screening', () => {
  const [a, b] = cofounders();
  const fit = intentFit(a, b, 'cofounder');
  assert.ok(fit.score >= tuning.screening.minFitToScreen);
  const original = tuning.screening.minFitToScreen;
  tuning.screening.minFitToScreen = fit.score + 0.01;
  try {
    assert.deepEqual(eligiblePairs(storeWith([a, b]), { now: NOW }), []);
  } finally {
    tuning.screening.minFitToScreen = original;
  }
});

test('people with no intent in common are never paired', () => {
  const a = member({ id: 'a', intents: ['cofounder'], intentProfiles: { cofounder: CO } });
  const b = member({ id: 'b', intents: ['partner'], intentProfiles: { partner: { relationshipIntent: 'serious', stayingPlans: 'staying', kids: 'want', ageBand: '30s', seekingAgeBands: ['30s'] } } });
  assert.deepEqual(eligiblePairs(storeWith([a, b]), { now: NOW }), []);
});

test('a pair already screened recently is not screened again', () => {
  const [a, b] = cofounders();
  const recent = {
    id: 's1', pairIds: ['a', 'b'], intent: 'cofounder', state: 'complete', createdAt: daysAgo(3), turns: [],
  };
  assert.deepEqual(eligiblePairs(storeWith([a, b], { screenings: [recent] }), { now: NOW }), []);
});

test('after the cooldown the same pair may be screened again', () => {
  const [a, b] = cofounders();
  const old = {
    id: 's1', pairIds: ['a', 'b'], intent: 'cofounder', state: 'complete',
    createdAt: daysAgo(tuning.screening.cooldownDays + 1), turns: [],
  };
  assert.equal(eligiblePairs(storeWith([a, b], { screenings: [old] }), { now: NOW }).length, 1);
});

test('a screening still running is never restarted', () => {
  const [a, b] = cofounders();
  const running = { id: 's1', pairIds: ['a', 'b'], intent: 'cofounder', state: 'running', createdAt: daysAgo(100), turns: [] };
  assert.deepEqual(eligiblePairs(storeWith([a, b], { screenings: [running] }), { now: NOW }), []);
});

test('a pair already introduced is never re-screened for that intent', () => {
  const [a, b] = cofounders();
  const intro = { id: 'i1', pairIds: ['a', 'b'], intent: 'cofounder', status: 'declined' };
  assert.deepEqual(eligiblePairs(storeWith([a, b], { introductions: [intro] }), { now: NOW }), []);
});

test('a blocked pair is never screened', () => {
  const [a, b] = cofounders();
  assert.deepEqual(eligiblePairs(storeWith([a, b], { blocks: [{ by: 'a', target: 'b' }] }), { now: NOW }), []);
});

test('nobody is put into two screenings in the same run', () => {
  const [a, b] = cofounders();
  const c = member({ id: 'c', intents: ['cofounder'], intentProfiles: { cofounder: CO2 } });
  const found = eligiblePairs(storeWith([a, b, c]), { now: NOW });
  const seen = found.flatMap((f) => f.pairIds);
  assert.equal(seen.length, new Set(seen).size);
});

test('the queue is capped so one run cannot cost the earth', () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    member({ id: `m${i}`, intents: ['cofounder'], intentProfiles: { cofounder: i % 2 ? CO : CO2 } }));
  assert.ok(eligiblePairs(storeWith(many), { now: NOW }).length <= tuning.screening.maxPairsPerRun);
});

test('a high-stakes match outranks a slightly better-scoring friend match', () => {
  // These four are all excellent friend matches; two of them are also cofounders.
  const shared = { interests: ['running', 'film', 'cooking'], availability: slots('tue:evening', 'thu:evening', 'sat:midday') };
  const a = member({ id: 'a', ...shared, intents: ['friend', 'cofounder'], intentProfiles: { cofounder: CO } });
  const b = member({ id: 'b', ...shared, intents: ['friend', 'cofounder'], intentProfiles: { cofounder: CO2 } });
  const c = member({ id: 'c', ...shared, intents: ['friend'] });
  const d = member({ id: 'd', ...shared, intents: ['friend'] });

  const found = eligiblePairs(storeWith([a, b, c, d]), { now: NOW });
  assert.equal(found[0].intent, 'cofounder', `expected cofounder first, got ${names(found)}`);
  assert.equal(found[0].stakes, 'high');
});

test('inactive members are never queued', () => {
  const [a, b] = cofounders();
  b.status = 'paused';
  assert.deepEqual(eligiblePairs(storeWith([a, b]), { now: NOW }), []);
});

// --- the conversation state machine ---------------------------------------

function freshScreening() {
  const [a, b] = cofounders();
  return openScreening({ pairIds: ['a', 'b'], intent: 'cofounder', fit: intentFit(a, b, 'cofounder'), now: NOW });
}

test('a new screening carries the fit verdict it was opened on', () => {
  const s = freshScreening();
  assert.equal(s.state, 'running');
  assert.equal(s.viable, undefined);
  assert.equal(s.fit.viable, true, 'fit.viable must survive, or every verdict defaults to pass');
  assert.ok(Array.isArray(s.fit.blockers));
  assert.ok(s.agenda.length > 0);
});

test('speakers alternate deterministically and the conversation is bounded', () => {
  const s = freshScreening();
  const order = [];
  while (!isComplete(s)) {
    const speaker = nextSpeaker(s);
    order.push(speaker);
    s.turns.push({ speakerId: speaker, message: `turn ${s.turns.length}`, unknowns: [], concerns: [] });
  }
  assert.equal(order.length, tuning.screening.maxTurns);
  assert.deepEqual(order.slice(0, 4), ['a', 'b', 'a', 'b']);
  assert.equal(nextSpeaker(s), null);
});

test('the two sides never ask the same question at the same time', () => {
  const s = freshScreening();
  while (!isComplete(s)) {
    const speaker = nextSpeaker(s);
    const topic = currentTopic(s, speaker);
    if (s.turns.length % 2 === 1) {
      const theirs = currentTopic({ ...s, turns: s.turns.slice(0, -1) }, s.pairIds[0]);
      assert.notEqual(topic, theirs, 'both delegates pushed the same agenda item');
    }
    s.turns.push({ speakerId: speaker, message: topic, unknowns: [], concerns: [] });
  }
  // Between them they cover the agenda rather than half of it twice.
  assert.ok(new Set(s.turns.map((t) => t.message)).size >= 3);
});

test('topic index stays inside the agenda however long the conversation runs', () => {
  const s = freshScreening();
  for (let i = 0; i < 40; i += 1) {
    for (const id of ['a', 'b']) {
      const idx = topicIndex(s, id);
      assert.ok(idx >= 0 && idx < s.agenda.length, `index ${idx} out of range`);
    }
    s.turns.push({ speakerId: nextSpeaker(s) ?? 'a', message: 'x', unknowns: [], concerns: [] });
  }
});

test('a delegate hears the other side, never its own last message', () => {
  const s = freshScreening();
  s.turns.push({ speakerId: 'a', message: 'from A', unknowns: [], concerns: [] });
  s.turns.push({ speakerId: 'b', message: 'from B', unknowns: [], concerns: [] });
  assert.equal(lastMessageTo(s, 'a').message, 'from B');
  assert.equal(lastMessageTo(s, 'b').message, 'from A');
});

test('the opening delegate has nothing to answer', () => {
  assert.equal(lastMessageTo(freshScreening(), 'a'), null);
});

test('unknowns are collected per side, for that side alone to answer', () => {
  const s = freshScreening();
  s.turns.push({ speakerId: 'a', message: 'x', unknowns: ['ask A about runway'], concerns: [] });
  s.turns.push({ speakerId: 'b', message: 'y', unknowns: ['ask B about equity'], concerns: [] });
  assert.deepEqual(unknownsFor(s, 'a'), ['ask A about runway']);
  assert.deepEqual(unknownsFor(s, 'b'), ['ask B about equity']);
});
