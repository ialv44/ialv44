import { DAYS } from '../config.js';
import { availabilitySlots } from './compatibility.js';

export const WINDOW_TIME = { morning: '09:00', midday: '12:30', evening: '18:30', late: '21:00' };

/**
 * Desirability of a slot for a recurring adult friendship ritual. Weekday
 * evenings and weekend middays are what actually survive contact with jobs,
 * kids and commutes.
 */
const SLOT_APPEAL = {
  'sat:midday': 1.0,
  'sun:midday': 0.98,
  'tue:evening': 0.95,
  'wed:evening': 0.95,
  'thu:evening': 0.93,
  'mon:evening': 0.85,
  'sat:morning': 0.8,
  'sun:morning': 0.8,
  'fri:evening': 0.7, // competes with everything else in a person's life
  'sat:evening': 0.7,
  'sun:evening': 0.65,
};

export function slotAppeal(slot) {
  if (SLOT_APPEAL[slot] !== undefined) return SLOT_APPEAL[slot];
  const [, window] = slot.split(':');
  if (window === 'evening') return 0.6;
  if (window === 'midday') return 0.55;
  if (window === 'morning') return 0.45;
  return 0.3; // late
}

/** slot -> list of member ids free then. */
export function slotCoverage(members) {
  const map = new Map();
  for (const m of members) {
    for (const slot of availabilitySlots(m)) {
      if (!map.has(slot)) map.set(slot, []);
      map.get(slot).push(m.id);
    }
  }
  return map;
}

/**
 * A ritual does not need everyone every time — that is the RSVP treadmill that
 * kills group plans. It needs a quorum, so whoever shows up still finds people.
 */
export function quorumFor(size) {
  return Math.max(3, Math.ceil(size * 0.6));
}

export function rankedSlots(members, { quorum = quorumFor(members.length) } = {}) {
  const coverage = slotCoverage(members);
  return [...coverage.entries()]
    .map(([slot, ids]) => ({
      slot,
      day: slot.split(':')[0],
      window: slot.split(':')[1],
      free: ids,
      coverage: ids.length / members.length,
      score: Number((0.65 * (ids.length / members.length) + 0.35 * slotAppeal(slot)).toFixed(4)),
    }))
    .filter((s) => s.free.length >= Math.min(quorum, members.length))
    .sort((a, b) => b.score - a.score || a.slot.localeCompare(b.slot));
}

export function hasViableSlot(members, quorum = quorumFor(members.length)) {
  return rankedSlots(members, { quorum }).length > 0;
}

/**
 * A venue archetype, not a specific address. Members pick the actual place —
 * the app's job is to make it the *same* place every time.
 *
 * Archetypes are scored by how many members share the interest behind them, so
 * one hiker in a pod of cooks does not send everyone to a park.
 */
const ARCHETYPES = [
  {
    tags: ['running', 'hiking', 'cycling', 'walking'],
    label: 'a park loop and a coffee after',
    why: 'you already move for fun, so the walking does the talking',
  },
  {
    tags: ['bouldering', 'climbing'],
    label: 'the same bouldering gym',
    why: 'climbing gives shy people something to do with their hands',
  },
  {
    tags: ['board games', 'chess', 'games'],
    label: 'a board game cafe',
    why: 'a table with a game on it does the small talk for you',
  },
  {
    tags: ['cooking', 'food', 'baking'],
    label: 'a market run, then a long table somewhere cheap',
    why: 'shopping and eating together is the cheapest intimacy there is',
  },
  {
    tags: ['film', 'music', 'photography', 'art'],
    label: 'the same cafe, then whatever is on nearby',
    why: 'a plan afterwards saves you from running out of things to say',
  },
];

export function venueArchetype(members) {
  const alcoholFree = members.some((m) => m.constraints.alcoholFree);
  const quiet = members.some((m) => m.constraints.quietPlaces);
  const lowBudget = members.some((m) => m.constraints.budget === 'low');
  const wantsLanguage = members.filter((m) => m.learning.length).length;

  const scored = ARCHETYPES.map((a) => ({
    ...a,
    count: members.filter((m) => m.interests.some((i) => a.tags.includes(i))).length,
  })).sort((x, y) => y.count - x.count);

  const best = scored[0];
  // A shared interest only picks the venue if it is actually shared. Every
  // archetype is a public place on purpose — first meets never happen at
  // anyone's home.
  if (best && best.count >= Math.max(2, Math.ceil(members.length / 2))) {
    return { label: best.label, why: best.why, alcoholFree, quiet, lowBudget };
  }
  if (wantsLanguage >= Math.ceil(members.length / 2)) {
    return {
      label: 'a quiet cafe with a two-language rule',
      why: 'half the hour in each language keeps it fair',
      alcoholFree, quiet, lowBudget,
    };
  }
  if (lowBudget || quiet || alcoholFree) {
    return {
      label: 'a neighbourhood cafe',
      why: 'cheap, sober, quiet enough to hear each other',
      alcoholFree, quiet, lowBudget,
    };
  }
  return {
    label: 'the same neighbourhood bar-cafe',
    why: 'a regular table beats a new venue every week',
    alcoholFree, quiet, lowBudget,
  };
}

export function nextOccurrence(ritual, from = new Date()) {
  const targetDay = DAYS.indexOf(ritual.day);
  if (targetDay < 0) return null;
  const jsTarget = (targetDay + 1) % 7; // DAYS starts Monday, JS getDay() starts Sunday
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  let delta = (jsTarget - d.getDay() + 7) % 7;
  const [hh, mm] = (WINDOW_TIME[ritual.window] || '18:30').split(':').map(Number);
  const candidate = new Date(d);
  candidate.setDate(d.getDate() + delta);
  candidate.setHours(hh, mm, 0, 0);
  if (candidate <= from) {
    delta += ritual.cadence === 'biweekly' ? 14 : 7;
    candidate.setDate(d.getDate() + delta);
    candidate.setHours(hh, mm, 0, 0);
  }
  return candidate;
}

export function buildRitual(members, { cadence = 'weekly', now = new Date() } = {}) {
  const slots = rankedSlots(members);
  if (!slots.length) return null;
  const best = slots[0];
  const venue = venueArchetype(members);
  const ritual = {
    day: best.day,
    window: best.window,
    time: WINDOW_TIME[best.window],
    cadence,
    quorum: quorumFor(members.length),
    coverage: best.coverage,
    venue,
    alternates: slots.slice(1, 3).map((s) => ({ day: s.day, window: s.window, coverage: s.coverage })),
    name: null, // the agent names it
    anchorPrompt: null, // the agent writes it
  };
  ritual.nextAt = nextOccurrence(ritual, now).toISOString();
  return ritual;
}
