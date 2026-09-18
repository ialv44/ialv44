import { tuning } from '../config.js';
import { daysInCity } from './profile.js';

const CONVERSANT = new Set(['native', 'fluent', 'conversational']);

function set(arr) {
  return new Set(arr);
}

function intersect(a, b) {
  const bb = set(b);
  return [...set(a)].filter((x) => bb.has(x));
}

/** Jaccard is harsh on short lists, so blend it with coverage-of-the-smaller-set. */
function tagScore(a, b) {
  if (!a.length || !b.length) return 0;
  const shared = intersect(a, b).length;
  if (!shared) return 0;
  const union = set([...a, ...b]).size;
  const jaccard = shared / union;
  const coverage = shared / Math.min(a.length, b.length);
  return 0.4 * jaccard + 0.6 * coverage;
}

export function spokenLanguages(member) {
  return member.languages.filter((l) => CONVERSANT.has(l.level)).map((l) => l.code);
}

export function sharedLanguages(a, b) {
  return intersect(spokenLanguages(a), spokenLanguages(b));
}

/** A teaches B and B teaches A: the strongest reason two strangers keep meeting. */
export function languageExchange(a, b) {
  const aTeaches = a.languages.some((l) => l.level === 'native' && b.learning.includes(l.code));
  const bTeaches = b.languages.some((l) => l.level === 'native' && a.learning.includes(l.code));
  if (aTeaches && bTeaches) return 'mutual';
  if (aTeaches || bTeaches) return 'one-way';
  return 'none';
}

export function availabilitySlots(member) {
  return member.availability.map((a) => `${a.day}:${a.window}`);
}

export function scheduleOverlap(a, b) {
  return intersect(availabilitySlots(a), availabilitySlots(b));
}

const ENERGY_RANK = { 'small-quiet': 0, mixed: 1, 'big-loud': 2 };

function socialStyleScore(a, b) {
  const gap = Math.abs(ENERGY_RANK[a.energyStyle] - ENERGY_RANK[b.energyStyle]);
  const energy = 1 - gap / 2; // 1.0 same, 0.5 adjacent, 0.0 opposite ends
  const plans = a.plansStyle === b.plansStyle ? 1 : 0.5;
  return 0.7 * energy + 0.3 * plans;
}

function proximityScore(a, b) {
  if (a.city.toLowerCase() !== b.city.toLowerCase()) return 0;
  if (a.neighborhood && a.neighborhood.toLowerCase() === b.neighborhood.toLowerCase()) return 1;
  return 0.6;
}

function languageScore(a, b) {
  const shared = sharedLanguages(a, b);
  if (!shared.length) return 0;
  const base = Math.min(1, 0.7 + 0.15 * (shared.length - 1));
  const exchange = languageExchange(a, b);
  const bonus = exchange === 'mutual' ? 0.3 : exchange === 'one-way' ? 0.12 : 0;
  return Math.min(1, base + bonus);
}

function scheduleScore(a, b) {
  const overlap = scheduleOverlap(a, b).length;
  if (!overlap) return 0;
  // Two shared slots is already a workable friendship; three is comfortable.
  return Math.min(1, 0.55 + 0.225 * (overlap - 1));
}

/**
 * Hard gates. These are not "low score" — they are reasons two people must
 * never be put in the same pod.
 */
export function blockers(a, b, { blocks = [] } = {}) {
  const reasons = [];
  if (a.id === b.id) reasons.push('same-person');
  if (a.status !== 'active' || b.status !== 'active') reasons.push('inactive');
  if (a.city.toLowerCase() !== b.city.toLowerCase()) reasons.push('different-city');
  if (!sharedLanguages(a, b).length) reasons.push('no-shared-language');
  if (!scheduleOverlap(a, b).length) reasons.push('no-shared-time');
  const blocked = blocks.some(
    (x) => (x.by === a.id && x.target === b.id) || (x.by === b.id && x.target === a.id),
  );
  if (blocked) reasons.push('blocked');
  return reasons;
}

/**
 * Pairwise compatibility in [0,1] plus the breakdown, so the agent can explain
 * a match in human words instead of quoting a number at people.
 */
export function compatibility(a, b, opts = {}) {
  const reasons = blockers(a, b, opts);
  const parts = {
    schedule: scheduleScore(a, b),
    interests: tagScore(a.interests, b.interests),
    seeking: tagScore(a.seeking, b.seeking),
    socialStyle: socialStyleScore(a, b),
    language: languageScore(a, b),
    proximity: proximityScore(a, b),
    lifeStage: tagScore(a.lifeStage, b.lifeStage),
  };
  const w = tuning.weights;
  const score = reasons.length
    ? 0
    : Object.keys(w).reduce((sum, k) => sum + w[k] * parts[k], 0);

  return {
    score: Number(score.toFixed(4)),
    viable: reasons.length === 0,
    blockers: reasons,
    parts,
    evidence: {
      sharedInterests: intersect(a.interests, b.interests),
      sharedSlots: scheduleOverlap(a, b),
      sharedLanguages: sharedLanguages(a, b),
      languageExchange: languageExchange(a, b),
      sharedSeeking: intersect(a.seeking, b.seeking),
      sameNeighborhood:
        Boolean(a.neighborhood) && a.neighborhood.toLowerCase() === b.neighborhood.toLowerCase(),
    },
  };
}

export function isAnchor(member, now = new Date()) {
  const d = daysInCity(member, now);
  return d !== null && d >= tuning.pod.anchorAfterDays;
}

export function isNewcomer(member, now = new Date()) {
  const d = daysInCity(member, now);
  return d !== null && d < 90;
}
