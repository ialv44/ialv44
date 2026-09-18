import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE_SCHEMA, POD_INTRO_SCHEMA, NUDGE_SCHEMA, VOICE, onboardingPrompt, podIntroPrompt, nudgePrompt } from '../src/agent/prompts.js';
import { onboardingTurn, introducePod, writeNudge, agentAvailable } from '../src/agent/index.js';
import { fallbackNudge } from '../src/agent/fallback.js';
import { NUDGE_KINDS } from '../src/core/nudges.js';
import { SEEKING, DAYS, WINDOWS } from '../src/config.js';
import { normalizeProfile } from '../src/core/profile.js';
import { member, slots } from './helpers.js';

// Without a key the agent layer must degrade, not throw. These tests run in
// exactly that mode, which is also how CI runs.
test('the agent is offline in this environment, so fallbacks are what is under test', () => {
  assert.equal(agentAvailable(), false);
});

// --- schema contracts ------------------------------------------------------
// The model's output schema and the code that consumes it drift apart silently.
// These assertions fail loudly instead.

function assertStrictObject(schema, path = 'root') {
  assert.equal(schema.type, 'object', `${path}: not an object schema`);
  assert.equal(schema.additionalProperties, false, `${path}: must forbid extra properties`);
  assert.ok(Array.isArray(schema.required), `${path}: missing required[]`);
  for (const key of schema.required) {
    assert.ok(schema.properties[key], `${path}: required key "${key}" is not defined`);
  }
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop.type === 'object') assertStrictObject(prop, `${path}.${key}`);
    if (prop.type === 'array' && prop.items?.type === 'object') assertStrictObject(prop.items, `${path}.${key}[]`);
  }
}

test('every agent schema is a strict JSON Schema object', () => {
  for (const [name, schema] of Object.entries({ PROFILE_SCHEMA, POD_INTRO_SCHEMA, NUDGE_SCHEMA })) {
    assertStrictObject(schema, name);
  }
});

test('the profile schema can only produce values the normaliser accepts', () => {
  const p = PROFILE_SCHEMA.properties.patch.properties;
  assert.deepEqual(p.seeking.items.enum, SEEKING);
  assert.deepEqual(p.availability.items.properties.day.enum, DAYS);
  assert.deepEqual(p.availability.items.properties.window.enum, WINDOWS);
  assert.deepEqual(p.energyStyle.enum, ['small-quiet', 'mixed', 'big-loud']);
  assert.deepEqual(p.plansStyle.enum, ['spontaneous', 'planner']);

  // Every property the model may return must survive normalisation.
  const maximal = {
    displayName: 'Ana', city: 'Lisbon', country: 'Portugal', neighborhood: 'Graça',
    homeCountry: 'Brazil', arrivedAt: '2024-03-01',
    languages: [{ code: 'pt', level: 'native' }], learning: ['de'], interests: ['running'],
    energyStyle: 'mixed', plansStyle: 'planner', lifeStage: ['no-kids'],
    seeking: ['weekly-regulars'], availability: [{ day: 'tue', window: 'evening' }], notes: 'hi',
  };
  assert.deepEqual(Object.keys(maximal).sort(), Object.keys(p).sort());
  const normalised = normalizeProfile(maximal);
  for (const key of Object.keys(maximal)) {
    assert.notEqual(normalised[key], undefined, `normaliser dropped "${key}"`);
  }
});

test('the pod intro schema supplies every field the pod record stores', () => {
  const required = POD_INTRO_SCHEMA.required;
  for (const key of ['podName', 'ritualName', 'why', 'anchorPrompt', 'firstStep', 'memberNotes']) {
    assert.ok(required.includes(key), `pod intro must require "${key}"`);
  }
});

test('the nudge schema supplies every field the nudge record stores', () => {
  for (const key of ['title', 'body', 'action', 'tone']) {
    assert.ok(NUDGE_SCHEMA.required.includes(key), `nudge must require "${key}"`);
  }
});

// --- fallback parity -------------------------------------------------------

test('every nudge kind the core can emit has copy to fall back on', () => {
  for (const kind of NUDGE_KINDS) {
    const copy = fallbackNudge({ kind, facts: { city: 'Lisbon', daysWaiting: 9, detail: 'x', milestone: 'six months in', missed: 2, coAttends: 3, ritual: { day: 'tue', window: 'evening', quorum: 3, venue: { label: 'a cafe' } } } });
    assert.ok(copy.title && copy.body, `no fallback copy for "${kind}"`);
    assert.notEqual(copy.title, 'An update', `"${kind}" falls through to the generic template`);
  }
});

test('every nudge kind is described in the prompt the model receives', () => {
  const prompt = nudgePrompt({ nudge: { kind: 'pre-meetup', audience: 'pod', facts: {} } });
  for (const kind of NUDGE_KINDS) {
    assert.ok(prompt.includes(`${kind}:`), `prompt never explains "${kind}"`);
  }
});

test('fallback results are marked offline so the UI can say so', async () => {
  const profile = normalizeProfile(member({ displayName: '' }));
  const turn = await onboardingTurn({ profile, transcript: [{ role: 'user', text: 'hi' }] });
  assert.equal(turn.offline, true);
  assert.equal(turn.degradedBecause, 'no-api-key');

  const members = Array.from({ length: 4 }, () => normalizeProfile(member({ availability: slots('tue:evening') })));
  const intro = await introducePod({
    members,
    ritual: { day: 'tue', window: 'evening', quorum: 3, venue: { label: 'a cafe' } },
    spine: { tag: 'running', count: 4 },
    cohesion: 0.6,
  });
  assert.equal(intro.offline, true);
  assert.ok(intro.podName && intro.why && intro.memberNotes.length === 4);

  const nudge = await writeNudge({ nudge: { kind: 'pod-welcome', audience: 'pod', facts: { ritual: { day: 'tue', window: 'evening', quorum: 3, venue: { label: 'a cafe' } } } } });
  assert.equal(nudge.offline, true);
  assert.ok(nudge.body.length > 0);
});

// --- prompt hygiene --------------------------------------------------------

test('the voice bans the vocabulary that makes this kind of app unbearable', () => {
  for (const word of ['networking', 'journey', 'tribe', 'your people']) {
    assert.ok(VOICE.includes(word), `voice does not ban "${word}"`);
  }
  assert.match(VOICE, /Do not invent venues/);
  assert.match(VOICE, /never ask for or repeat contact\s+details/);
});

test('prompts never hand the model a private field', () => {
  const m = normalizeProfile(member({ displayName: 'Ana' }));
  const prompts = [
    onboardingPrompt({ transcript: [{ role: 'user', text: 'hi' }], profile: m, completeness: 0.5 }),
    podIntroPrompt({ members: [m], ritual: {}, spine: null, cohesion: 0.5, warnings: [] }),
    nudgePrompt({ nudge: { kind: 'pod-welcome', audience: 'pod', facts: {} }, subject: null, pod: null, members: [] }),
  ];
  // publicView is what reaches the model for other people; onboarding is the
  // member's own data, but their conversation log must not be replayed as state.
  for (const p of prompts) assert.ok(!p.includes('"onboarding"'), 'a transcript leaked into a prompt');
});
