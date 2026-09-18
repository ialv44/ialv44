import { INTENT_FIELDS } from '../core/intent-fields.js';
import { readinessGaps } from '../core/screening.js';

/**
 * Offline delegates.
 *
 * These cannot hold a conversation, but they can do the one thing that matters:
 * state their person's answers accurately and admit what they do not know. The
 * verdict then comes from the deterministic fit and the gaps, which is a
 * defensible recommendation even with no model in the loop.
 */

const COMMITMENT_WORDS = {
  'full-time': 'is going full-time on it',
  'part-time': 'is on it part-time',
  'nights-weekends': 'is on it nights and weekends',
  exploring: 'is still just exploring',
};

/** Each formatter returns a complete predicate, so they can be listed after a
 *  name without the sentence falling apart. */
const HUMAN = {
  commitment: (v) => COMMITMENT_WORDS[v] || `is ${v} on it`,
  stage: (v) => `is at ${v} stage`,
  timeline: (v) => (v === 'now' ? 'wants to start now' : `is looking to start in ${v.replace('-', ' ')}`),
  equityStance: (v) => (v === 'majority' ? 'wants majority' : `is ${v} on equity`),
  runwayMonths: (v) => `has about ${v} months of runway`,
  priorFounder: (v) => (v ? 'has founded before' : 'has not founded before'),
  domains: (v) => `works in ${andList(v)}`,
  brings: (v) => `brings ${andList(v)}`,
  needs: (v) => `needs ${andList(v)}`,
  relationshipIntent: (v) => `is looking for something ${v.replace(/-/g, ' ')}`,
  stayingPlans: (v) => ({
    staying: 'is planning to stay',
    'few-years': 'is here for a few years',
    temporary: 'is here temporarily',
    unsure: 'is not sure how long they are staying',
  }[v] || `is ${v}`),
  kids: (v) => ({
    want: 'wants children',
    have: 'has children',
    'dont-want': 'does not want children',
    unsure: 'is unsure about children',
  }[v] || v),
  ageBand: (v) => `is in their ${v}`,
  role: (v) => (v === 'offering' ? 'is offering to mentor' : 'is looking for a mentor'),
  seniority: (v) => `is ${v} level`,
  hoursPerMonth: (v) => `has about ${v} hours a month`,
  activities: (v) => `does ${andList(v)}`,
  level: (v) => `is at ${v} level`,
};

function andList(v) {
  const items = Array.isArray(v) ? v : [v];
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** A factual sentence built only from what the profile actually contains. */
export function describe(member, intentKey) {
  const p = member.intentProfiles?.[intentKey] || {};
  const parts = Object.keys(INTENT_FIELDS[intentKey] || {})
    .filter((f) => p[f] !== undefined && HUMAN[f])
    .map((f) => HUMAN[f](p[f]));

  if (!parts.length) {
    const bits = [
      member.city && `is in ${member.city}`,
      member.interests.length && `is into ${member.interests.slice(0, 3).join(', ')}`,
      member.availability.length && `is free ${member.availability.slice(0, 2).map((a) => `${a.day} ${a.window}s`).join(' and ')}`,
    ].filter(Boolean);
    return bits.join(', ') || 'has not filled much in yet';
  }
  // Four facts is an introduction; ten is a CV nobody reads.
  return parts.slice(0, 4).join(', ');
}

function asQuestion(topic) {
  const t = String(topic || '').trim();
  if (!t) return 'Anything else I should know?';
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}?`;
}

/**
 * Which profile fields answer which agenda item, per intent, aligned to the
 * agenda arrays in intents.js. An empty entry is deliberate: some questions —
 * how you handled a serious disagreement, what would make you walk away — have
 * no field and never will. The offline delegate says so and records it, which
 * is the behaviour we want from the real one too.
 */
const AGENDA_FIELDS = {
  friend: [['@availability', '@interests'], ['@seeking'], []],
  cofounder: [['commitment', 'runwayMonths', 'timeline'], [], ['brings', 'needs', 'equityStance'], []],
  partner: [['stayingPlans'], ['relationshipIntent', 'kids'], ['@availability', '@interests']],
  mentor: [['role', 'domains', 'seniority'], ['hoursPerMonth']],
  activity: [['activities', 'level'], ['@availability']],
};

const BASE_HUMAN = {
  '@availability': (m) => (m.availability.length
    ? `is free ${m.availability.slice(0, 3).map((a) => `${a.day} ${a.window}s`).join(', ')}`
    : null),
  '@interests': (m) => (m.interests.length ? `is into ${m.interests.slice(0, 4).join(', ')}` : null),
  '@seeking': (m) => (m.seeking.length ? `is after ${andList(m.seeking.map((x) => x.replace(/-/g, ' ')))}` : null),
};

function answerTo(me, intentKey, topicIndex) {
  const wanted = AGENDA_FIELDS[intentKey]?.[topicIndex] ?? [];
  const p = me.intentProfiles?.[intentKey] || {};
  const said = [];
  const missing = [];

  for (const field of wanted) {
    if (field.startsWith('@')) {
      const v = BASE_HUMAN[field]?.(me);
      if (v) said.push(v); else missing.push(field.slice(1));
    } else if (p[field] !== undefined && HUMAN[field]) {
      said.push(HUMAN[field](p[field]));
    } else {
      missing.push(field);
    }
  }
  return { said, missing, hasField: wanted.length > 0 };
}

export function fallbackDelegateTurn({ me, them, intentKey, topic, topicIndex = 0, incoming }) {
  const gaps = readinessGaps(me, intentKey);
  const { said, missing, hasField } = answerTo(me, intentKey, topicIndex);

  let answer;
  const unknowns = [];
  if (!incoming) {
    answer = `${me.displayName} ${describe(me, intentKey)}.`;
  } else if (said.length) {
    answer = `${me.displayName} ${said.join(', ')}.`;
  } else {
    // Nothing in the profile covers this. Say so rather than fill the gap.
    answer = hasField
      ? `${me.displayName} has not told me about ${missing.map(labelFor).join(' or ')}, so I will not guess — I will ask them.`
      : `That is not something ${me.displayName} has told me, and it is not the kind of thing I would guess at. I will put it to them.`;
    unknowns.push(hasField ? `What should I say about ${labelFor(missing[0])}?` : capitalise(topic) + '?');
  }

  for (const g of gaps.slice(0, 1)) {
    const q = `What should I say about ${labelFor(g)}?`;
    if (!unknowns.includes(q)) unknowns.push(q);
  }

  return {
    message: `${answer} ${asQuestion(topic)}`,
    unknowns: unknowns.slice(0, 2),
    concerns: [],
    offline: true,
  };
}

function capitalise(s) {
  const t = String(s || '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function labelFor(field) {
  return String(field)
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toLowerCase())
    .trim();
}

const GATE_REASONS = {
  'commitment-mismatch': 'one of you is going full-time and the other is not, which is the thing that breaks cofounders',
  'equity-conflict': 'you both want majority',
  'intent-mismatch': 'you are looking for different things',
  'age-mismatch': 'you are outside each other’s stated range',
  'kids-mismatch': 'you want opposite things about children',
  'horizon-mismatch': 'one of you is staying and one of you is not',
  'no-shared-time': 'your free hours do not overlap',
  'no-working-overlap': 'you would never be working at the same time',
  'no-shared-domain': 'you do not work in the same area',
  'same-role': 'you are both looking for the same side of it',
  dealbreaker: 'a stated dealbreaker',
};

/**
 * A verdict from the numbers alone. Honest about being a template — it never
 * claims to have read the conversation, because it has not.
 */
export function fallbackVerdict({ me, them, intentKey, fit, unknowns = [], intent }) {
  const gaps = readinessGaps(me, intentKey);
  const strong = Object.entries(fit.parts || {})
    .sort((a, b) => b[1] - a[1])
    .filter(([, v]) => v >= 0.6)
    .slice(0, 3);
  const weak = Object.entries(fit.parts || {})
    .sort((a, b) => a[1] - b[1])
    .filter(([, v]) => v < 0.45)
    .slice(0, 2);

  let verdict = 'pass';
  if (!fit.viable) verdict = 'pass';
  else if (gaps.length > 1 || unknowns.length > 2) verdict = 'hold';
  else if (fit.score >= 0.6) verdict = 'recommend';
  else if (fit.score >= 0.45) verdict = 'hold';

  const ev = fit.evidence || {};
  const why = [];
  if (ev.theyCoverYourGaps?.length) why.push(`They cover ${ev.theyCoverYourGaps.join(' and ')}, which you said you need.`);
  if (ev.sharedDomains?.length) why.push(`You are both in ${ev.sharedDomains.join(' and ')}.`);
  if (ev.sharedInterests?.length) why.push(`Shared: ${ev.sharedInterests.slice(0, 3).join(', ')}.`);
  if (ev.sharedActivities?.length) why.push(`You both do ${ev.sharedActivities.slice(0, 2).join(' and ')}.`);
  if (ev.sharedSlots?.length) why.push(`You are both free ${ev.sharedSlots.slice(0, 2).join(' and ')}.`);
  for (const [k] of strong) if (why.length < 3) why.push(`${capitalise(labelFor(k))} lines up.`);
  if (!why.length) why.push('The basics line up on paper.');

  const watchOuts = weak.map(([k]) => `${capitalise(labelFor(k))} is the weak point here.`);
  if (!fit.viable) {
    watchOuts.unshift(
      (fit.blockers || []).map((b) => GATE_REASONS[b] || b).join('; ') || 'a hard mismatch',
    );
  }
  if (verdict !== 'recommend' && !watchOuts.length) watchOuts.push('Not enough to go on yet.');

  return {
    verdict,
    confidence: Number(Math.min(0.7, 0.3 + fit.score * 0.5).toFixed(2)),
    headline: {
      recommend: `Worth meeting — ${them.displayName} lines up on the things you said mattered`,
      hold: `${them.displayName} might work, but I need more from you first`,
      pass: `I would skip ${them.displayName}`,
    }[verdict],
    why,
    watchOuts,
    openQuestions: [...new Set([...unknowns, ...gaps.map((g) => `What is your position on ${labelFor(g)}?`)])].slice(0, 4),
    suggestedFirstStep: {
      friend: 'One coffee, somewhere public, an hour.',
      cofounder: 'A ninety-minute working session on one real problem, before any talk of equity.',
      partner: 'A drink or a walk on neutral ground, an hour, no dinner.',
      mentor: 'One thirty-minute call with one specific question prepared.',
      activity: 'Just go and do the thing together once.',
    }[intentKey] || 'One coffee, somewhere public.',
    offline: true,
  };
}
