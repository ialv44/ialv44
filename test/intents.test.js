import test from 'node:test';
import assert from 'node:assert/strict';
import { INTENTS, INTENT_KEYS, intentFit, bestSharedIntent, sharedIntents, getIntent } from '../src/core/intents.js';
import { normalizeIntentProfile, missingIntentFields, INTENT_FIELDS } from '../src/core/intent-fields.js';
import { member, slots } from './helpers.js';

const withIntent = (key, profile, overrides = {}) =>
  member({ intents: ['friend', key], intentProfiles: { [key]: profile }, ...overrides });

const CO = {
  commitment: 'full-time', stage: 'prototype', timeline: 'now', domains: ['climate'],
  brings: ['engineering'], needs: ['sales'], equityStance: 'equal', runwayMonths: 12, priorFounder: false,
};

// --- registry hygiene ------------------------------------------------------

test('every intent is complete and its weights sum to one', () => {
  for (const key of INTENT_KEYS) {
    const i = getIntent(key);
    assert.equal(typeof i.gates, 'function', `${key}: no gates`);
    assert.ok(i.agenda.length > 0, `${key}: no screening agenda`);
    assert.ok(i.verdictCriteria.length > 20, `${key}: no verdict criteria`);
    assert.ok(['low', 'medium', 'high'].includes(i.stakes), `${key}: bad stakes`);
    const sum = Object.values(i.weights).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${key}: weights sum to ${sum}`);
    if (key !== 'friend') {
      const parts = Object.keys(i.score(member(), member()).parts);
      assert.deepEqual(parts.sort(), Object.keys(i.weights).sort(), `${key}: scorer/weights mismatch`);
    }
  }
});

test('an unknown intent throws rather than silently matching on nothing', () => {
  assert.throws(() => getIntent('astrology'), /unknown intent/);
});

test('intent fit is symmetric for every intent', () => {
  const pairs = {
    cofounder: [withIntent('cofounder', CO), withIntent('cofounder', { ...CO, brings: ['sales'], needs: ['engineering'] })],
    partner: [
      withIntent('partner', { relationshipIntent: 'serious', stayingPlans: 'staying', kids: 'want', ageBand: '30s', seekingAgeBands: ['30s'] }),
      withIntent('partner', { relationshipIntent: 'serious', stayingPlans: 'staying', kids: 'want', ageBand: '30s', seekingAgeBands: ['30s'] }),
    ],
    mentor: [
      withIntent('mentor', { role: 'offering', domains: ['product'], seniority: 'lead', hoursPerMonth: 3 }),
      withIntent('mentor', { role: 'seeking', domains: ['product'], seniority: 'junior', hoursPerMonth: 3 }),
    ],
    activity: [withIntent('activity', { activities: ['running'], level: 'regular' }), withIntent('activity', { activities: ['running'], level: 'regular' })],
    friend: [member(), member()],
  };
  for (const [key, [a, b]] of Object.entries(pairs)) {
    assert.equal(intentFit(a, b, key).score, intentFit(b, a, key).score, `${key} is asymmetric`);
  }
});

// --- cofounder -------------------------------------------------------------

test('cofounders are scored on complementary skills, not shared ones', () => {
  const a = withIntent('cofounder', CO);
  const complement = withIntent('cofounder', { ...CO, brings: ['sales'], needs: ['engineering'] });
  const twin = withIntent('cofounder', CO);
  assert.ok(
    intentFit(a, complement, 'cofounder').score > intentFit(a, twin, 'cofounder').score,
    'two identical engineers should not outrank an engineer and a seller',
  );
  assert.deepEqual(intentFit(a, complement, 'cofounder').evidence.theyCoverYourGaps, ['sales']);
});

test('a two-step commitment gap is a hard gate, however good the rest is', () => {
  const fullTime = withIntent('cofounder', CO);
  const weekends = withIntent('cofounder', { ...CO, commitment: 'nights-weekends', brings: ['sales'], needs: ['engineering'] });
  const fit = intentFit(fullTime, weekends, 'cofounder');
  assert.equal(fit.viable, false);
  assert.equal(fit.score, 0);
  assert.ok(fit.blockers.includes('commitment-mismatch'));
});

test('one step of commitment difference is survivable', () => {
  const full = withIntent('cofounder', CO);
  const part = withIntent('cofounder', { ...CO, commitment: 'part-time', brings: ['sales'], needs: ['engineering'] });
  assert.equal(intentFit(full, part, 'cofounder').viable, true);
});

test('two people who both want majority are gated', () => {
  const a = withIntent('cofounder', { ...CO, equityStance: 'majority' });
  const b = withIntent('cofounder', { ...CO, equityStance: 'majority', brings: ['sales'], needs: ['engineering'] });
  assert.ok(intentFit(a, b, 'cofounder').blockers.includes('equity-conflict'));
});

test('cofounders who are never awake at the same time are gated', () => {
  const a = withIntent('cofounder', CO, { availability: slots('tue:evening') });
  const b = withIntent('cofounder', { ...CO, brings: ['sales'], needs: ['engineering'] }, { availability: slots('sun:morning') });
  assert.ok(intentFit(a, b, 'cofounder').blockers.includes('no-working-overlap'));
});

// --- partner ---------------------------------------------------------------

const P = { relationshipIntent: 'serious', stayingPlans: 'staying', kids: 'want', ageBand: '30s', seekingAgeBands: ['30s'] };

test('the question expats avoid is a hard gate when both want something serious', () => {
  const staying = withIntent('partner', P);
  const leaving = withIntent('partner', { ...P, stayingPlans: 'temporary' });
  assert.ok(intentFit(staying, leaving, 'partner').blockers.includes('horizon-mismatch'));
});

test('different horizons do not gate when nobody is asking for forever', () => {
  const a = withIntent('partner', { ...P, relationshipIntent: 'casual', stayingPlans: 'staying' });
  const b = withIntent('partner', { ...P, relationshipIntent: 'casual', stayingPlans: 'temporary' });
  assert.equal(intentFit(a, b, 'partner').viable, true);
});

test('age interest has to run both ways', () => {
  const older = withIntent('partner', { ...P, ageBand: '40s', seekingAgeBands: ['30s'] });
  const younger = withIntent('partner', { ...P, ageBand: '30s', seekingAgeBands: ['30s'] });
  assert.ok(intentFit(older, younger, 'partner').blockers.includes('age-mismatch'));
});

test('opposite positions on children are a gate, unsure is not', () => {
  const wants = withIntent('partner', P);
  const doesNot = withIntent('partner', { ...P, kids: 'dont-want' });
  const unsure = withIntent('partner', { ...P, kids: 'unsure' });
  assert.ok(intentFit(wants, doesNot, 'partner').blockers.includes('kids-mismatch'));
  assert.equal(intentFit(wants, unsure, 'partner').viable, true);
});

test('casual and serious are a gate; adjacent intents are not', () => {
  const serious = withIntent('partner', P);
  const casual = withIntent('partner', { ...P, relationshipIntent: 'casual' });
  const open = withIntent('partner', { ...P, relationshipIntent: 'open-to-serious' });
  assert.ok(intentFit(serious, casual, 'partner').blockers.includes('intent-mismatch'));
  assert.equal(intentFit(serious, open, 'partner').viable, true);
});

test('a stated dealbreaker gates the pair', () => {
  const a = withIntent('partner', { ...P, dealbreakers: ['smoking'] });
  const b = withIntent('partner', P, { interests: ['smoking', 'film'] });
  assert.ok(intentFit(a, b, 'partner').blockers.includes('dealbreaker'));
});

// --- mentor and activity ---------------------------------------------------

test('two people offering to mentor are not a mentorship', () => {
  const a = withIntent('mentor', { role: 'offering', domains: ['product'], seniority: 'lead', hoursPerMonth: 3 });
  const b = withIntent('mentor', { role: 'offering', domains: ['product'], seniority: 'senior', hoursPerMonth: 3 });
  assert.ok(intentFit(a, b, 'mentor').blockers.includes('same-role'));
});

test('a mentor pair needs a shared domain and a real seniority gap', () => {
  const lead = withIntent('mentor', { role: 'offering', domains: ['product'], seniority: 'lead', hoursPerMonth: 3 });
  const junior = withIntent('mentor', { role: 'seeking', domains: ['product'], seniority: 'junior', hoursPerMonth: 3 });
  const peer = withIntent('mentor', { role: 'seeking', domains: ['product'], seniority: 'senior', hoursPerMonth: 3 });
  const other = withIntent('mentor', { role: 'seeking', domains: ['law'], seniority: 'junior', hoursPerMonth: 3 });
  assert.ok(intentFit(lead, junior, 'mentor').score > intentFit(lead, peer, 'mentor').score);
  assert.ok(intentFit(lead, other, 'mentor').blockers.includes('no-shared-domain'));
});

test('an activity pair needs an activity in common', () => {
  const runner = withIntent('activity', { activities: ['running'], level: 'regular' }, { interests: ['running'] });
  const chess = withIntent('activity', { activities: ['chess'], level: 'regular' }, { interests: ['chess'] });
  assert.ok(intentFit(runner, chess, 'activity').blockers.includes('no-shared-activity'));
});

// --- cross-cutting ---------------------------------------------------------

test('a block gates every intent, not just the one being matched', () => {
  const a = withIntent('cofounder', CO);
  const b = withIntent('cofounder', { ...CO, brings: ['sales'], needs: ['engineering'] });
  const opts = { blocks: [{ by: b.id, target: a.id }] };
  for (const key of ['friend', 'cofounder']) {
    assert.ok(intentFit(a, b, key, opts).blockers.includes('blocked'), `${key} ignored a block`);
  }
});

test('no shared language gates every intent', () => {
  const pt = withIntent('cofounder', CO, { languages: [{ code: 'pt', level: 'native' }] });
  const ja = withIntent('cofounder', { ...CO, brings: ['sales'], needs: ['engineering'] }, { languages: [{ code: 'ja', level: 'native' }] });
  assert.ok(intentFit(pt, ja, 'cofounder').blockers.includes('no-shared-language'));
});

test('bestSharedIntent picks the highest-scoring intent both people declared', () => {
  const a = member({
    intents: ['friend', 'cofounder'],
    intentProfiles: { cofounder: CO },
  });
  const b = member({
    intents: ['friend', 'cofounder'],
    intentProfiles: { cofounder: { ...CO, brings: ['sales'], needs: ['engineering'] } },
  });
  assert.deepEqual(sharedIntents(a, b).sort(), ['cofounder', 'friend']);
  assert.equal(bestSharedIntent(a, b).intent, 'cofounder');
});

test('people with no intent in common produce no match at all', () => {
  const a = member({ intents: ['cofounder'], intentProfiles: { cofounder: CO } });
  const b = member({ intents: ['partner'], intentProfiles: { partner: P } });
  assert.deepEqual(sharedIntents(a, b), []);
  assert.equal(bestSharedIntent(a, b), null);
});

// --- field normalisation ---------------------------------------------------

test('intent fields coerce what is valid and drop what is not', () => {
  const p = normalizeIntentProfile('cofounder', {
    commitment: 'FULL-TIME', stage: 'nonsense', runwayMonths: '9999',
    brings: 'engineering, ML', priorFounder: 'yes', injected: 'x',
  });
  assert.equal(p.commitment, 'full-time');
  assert.equal(p.stage, undefined, 'an invalid enum must not be stored');
  assert.equal(p.runwayMonths, 120);
  assert.deepEqual(p.brings, ['engineering', 'ml']);
  assert.equal(p.priorFounder, true);
  assert.equal(p.injected, undefined, 'unknown keys must be dropped');
});

test('an absent field stays absent rather than becoming a default', () => {
  const p = normalizeIntentProfile('partner', { relationshipIntent: 'serious' });
  assert.equal(p.kids, undefined);
  assert.ok(missingIntentFields('partner', p).includes('kids'));
  assert.equal(missingIntentFields('partner', p).includes('relationshipIntent'), false);
});

test('dropping an intent keeps its answers for when it comes back', async () => {
  const { normalizeProfile } = await import('../src/core/profile.js');
  const withCo = normalizeProfile({ displayName: 'A', intents: ['friend', 'cofounder'], intentProfiles: { cofounder: CO } });
  const dropped = normalizeProfile({ intents: ['friend'] }, withCo);
  assert.deepEqual(dropped.intents, ['friend']);
  assert.equal(dropped.intentProfiles.cofounder.commitment, 'full-time', 'answers were wiped');

  const restored = normalizeProfile({ intents: ['friend', 'cofounder'] }, dropped);
  assert.equal(restored.intentProfiles.cofounder.runwayMonths, 12);
});

test('an undeclared intent is never matched on or shown', async () => {
  const { normalizeProfile, publicView } = await import('../src/core/profile.js');
  const withCo = normalizeProfile({ displayName: 'A', intents: ['friend', 'cofounder'], intentProfiles: { cofounder: CO } });
  const dropped = normalizeProfile({ intents: ['friend'] }, withCo);
  const other = member({ intents: ['friend', 'cofounder'], intentProfiles: { cofounder: CO } });
  assert.deepEqual(sharedIntents(dropped, other), ['friend']);
  assert.equal(publicView(dropped).intentProfiles.cofounder, undefined);
});

test('every intent field is formatted by the offline delegate', async () => {
  const { describe: describeFields } = await import('../src/agent/delegate-fallback.js');
  for (const key of INTENT_KEYS) {
    const fields = Object.keys(INTENT_FIELDS[key]);
    if (!fields.length) continue;
    const m = member({ intents: [key], intentProfiles: { [key]: sampleFor(key) } });
    const text = describeFields(m, key);
    assert.ok(text.length > 0 && !text.includes('undefined'), `${key}: "${text}"`);
  }
});

function sampleFor(key) {
  return {
    cofounder: CO,
    partner: P,
    mentor: { role: 'offering', domains: ['product'], seniority: 'lead', hoursPerMonth: 3 },
    activity: { activities: ['running'], level: 'regular' },
    friend: {},
  }[key];
}
