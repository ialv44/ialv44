import { intersect, tagScore, sharedLanguages, scheduleOverlap, compatibility } from './compatibility.js';
import { tuning } from '../config.js';
import { COMMITMENT, TIMELINE, RELATIONSHIP, HORIZON, SENIORITY, LEVEL } from './intent-fields.js';

/**
 * Intents.
 *
 * The same machinery — prefilter, agent-to-agent screening, owner approval —
 * serves looking for a friend, a cofounder, a partner, a mentor or someone to
 * do a thing with. What changes per intent is only three things:
 *
 *   gates()   what is never traded off, however good the rest looks
 *   score()   what "fit" even means (friends want similarity; cofounders want
 *             the same commitment and *different* skills)
 *   agenda    what the delegates need to find out that a form cannot ask
 *
 * Adding an intent means adding one entry here. Nothing else in the pipeline
 * knows what a cofounder is.
 */

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const lower = (s) => String(s ?? '').trim().toLowerCase();
const list = (v) => (Array.isArray(v) ? v.map(lower).filter(Boolean) : []);

/** Ordinal scales: distance along the scale is what matters, not equality. */
function ordinalScore(scale, a, b, fatalGap = Infinity) {
  const i = scale.indexOf(a);
  const j = scale.indexOf(b);
  if (i < 0 || j < 0) return { score: 0.5, gap: null, unknown: true };
  const gap = Math.abs(i - j);
  return { score: gap >= fatalGap ? 0 : 1 - gap / (scale.length - 1), gap, unknown: false };
}

/** Gates every intent shares: the ones that are about safety or basic viability. */
function universalGates(a, b, { blocks = [] } = {}) {
  const out = [];
  if (a.id === b.id) out.push('same-person');
  if (a.status !== 'active' || b.status !== 'active') out.push('inactive');
  if (!sharedLanguages(a, b).length) out.push('no-shared-language');
  if (blocks.some((x) => (x.by === a.id && x.target === b.id) || (x.by === b.id && x.target === a.id))) {
    out.push('blocked');
  }
  return out;
}

const sub = (m, intent) => m.intentProfiles?.[intent] || {};

// --- friend ----------------------------------------------------------------

const friend = {
  key: 'friend',
  label: 'a friend',
  blurb: 'People to see regularly, in a group that keeps going without effort.',
  producesPods: true,
  producesIntros: true,
  stakes: 'low',
  fields: [],
  gates(a, b, opts) {
    const out = universalGates(a, b, opts);
    if (lower(a.city) !== lower(b.city)) out.push('different-city');
    if (!scheduleOverlap(a, b).length) out.push('no-shared-time');
    return out;
  },
  weights: tuning.weights,
  score: null, // the friend scorer is compatibility() itself
  agenda: [
    'what a good week looks like for them here',
    'whether they are after a regular group or one close friend',
    'what made the last friendship they made here work or not work',
  ],
  verdictCriteria:
    'Would these two actually keep showing up for each other? Shared free hours and a reason to repeat matter more than having the same taste.',
};

// --- cofounder -------------------------------------------------------------


const cofounder = {
  key: 'cofounder',
  label: 'a cofounder',
  blurb: 'Someone to build with. Same commitment, different skills.',
  producesPods: false,
  producesIntros: true,
  stakes: 'high',
  fields: ['commitment', 'stage', 'timeline', 'domains', 'brings', 'needs', 'equityStance', 'runwayMonths', 'priorFounder'],
  gates(a, b, opts) {
    const out = universalGates(a, b, opts);
    const A = sub(a, 'cofounder');
    const B = sub(b, 'cofounder');

    // Someone quitting their job and someone tinkering on Sundays is not a
    // difference of degree. It is the single most common way cofounding fails.
    const c = ordinalScore(COMMITMENT, A.commitment, B.commitment, 2);
    if (!c.unknown && c.gap >= 2) out.push('commitment-mismatch');

    if (A.equityStance === 'majority' && B.equityStance === 'majority') out.push('equity-conflict');

    // They have to be able to work at the same time as each other, at least
    // sometimes. Remote is fine; never overlapping is not.
    if (!scheduleOverlap(a, b).length) out.push('no-working-overlap');
    return out;
  },
  weights: {
    commitment: 0.24,
    complementarity: 0.20,
    domain: 0.16,
    timeline: 0.12,
    workStyle: 0.12,
    schedule: 0.10,
    risk: 0.06,
  },
  score(a, b) {
    const A = sub(a, 'cofounder');
    const B = sub(b, 'cofounder');

    // Unlike every other intent, difference is the point: the best score here
    // is when each one's skills cover the other's gaps.
    const aCovers = intersect(list(A.brings), list(B.needs)).length;
    const bCovers = intersect(list(B.brings), list(A.needs)).length;
    const wanted = Math.max(1, Math.min(list(A.needs).length, list(B.needs).length));
    const overlapPenalty = tagScore(list(A.brings), list(B.brings)) * 0.35;
    const complementarity = clamp01(
      (Math.min(aCovers, wanted) / wanted) * 0.5 + (Math.min(bCovers, wanted) / wanted) * 0.5 - overlapPenalty,
    );

    const runwayGap = Math.abs((Number(A.runwayMonths) || 0) - (Number(B.runwayMonths) || 0));
    const priorBalance = A.priorFounder === B.priorFounder ? 0.7 : 1; // one veteran, one hungry

    return {
      parts: {
        commitment: ordinalScore(COMMITMENT, A.commitment, B.commitment).score,
        complementarity,
        domain: tagScore(list(A.domains), list(B.domains)),
        timeline: ordinalScore(TIMELINE, A.timeline, B.timeline).score,
        workStyle: 0.6 * (a.plansStyle === b.plansStyle ? 1 : 0.45) + 0.4 * priorBalance,
        schedule: clamp01(scheduleOverlap(a, b).length / 3),
        risk: clamp01(1 - runwayGap / 12),
      },
      evidence: {
        theyCoverYourGaps: intersect(list(B.brings), list(A.needs)),
        youCoverTheirGaps: intersect(list(A.brings), list(B.needs)),
        sharedDomains: intersect(list(A.domains), list(B.domains)),
        overlappingSkills: intersect(list(A.brings), list(B.brings)),
        commitmentGap: ordinalScore(COMMITMENT, A.commitment, B.commitment).gap,
        stages: [A.stage, B.stage],
      },
    };
  },
  agenda: [
    'what they actually mean by full-time — funded, savings, or hoping',
    'how they have handled a serious disagreement with someone they worked with',
    'what they want to own and what they would happily hand over',
    'what would make them walk away in month nine',
  ],
  verdictCriteria:
    'Cofounding is a decade-long, hard-to-exit commitment. Weight honesty about money, time and conflict far above enthusiasm or a shared interest in the same market.',
};

// --- partner ---------------------------------------------------------------


const partner = {
  key: 'partner',
  label: 'a partner',
  blurb: 'Dating, with the question everyone abroad avoids asked up front.',
  producesPods: false,
  producesIntros: true,
  stakes: 'high',
  fields: ['relationshipIntent', 'stayingPlans', 'kids', 'ageBand', 'seekingAgeBands', 'dealbreakers'],
  gates(a, b, opts) {
    const out = universalGates(a, b, opts);
    const A = sub(a, 'partner');
    const B = sub(b, 'partner');

    const r = ordinalScore(RELATIONSHIP, A.relationshipIntent, B.relationshipIntent, 2);
    if (!r.unknown && r.gap >= 2) out.push('intent-mismatch');

    // Both have to be looking for the other's band. One-way interest is not a match.
    const aWants = list(A.seekingAgeBands);
    const bWants = list(B.seekingAgeBands);
    if (aWants.length && !aWants.includes(lower(B.ageBand))) out.push('age-mismatch');
    if (bWants.length && !bWants.includes(lower(A.ageBand))) out.push('age-mismatch');

    if (A.kids && B.kids && ((A.kids === 'want' && B.kids === 'dont-want') || (A.kids === 'dont-want' && B.kids === 'want'))) {
      out.push('kids-mismatch');
    }

    // The expat-specific one nobody asks until month four.
    const bothSerious = A.relationshipIntent === 'serious' && B.relationshipIntent === 'serious';
    if (bothSerious && ((A.stayingPlans === 'staying' && B.stayingPlans === 'temporary') ||
        (A.stayingPlans === 'temporary' && B.stayingPlans === 'staying'))) {
      out.push('horizon-mismatch');
    }

    const hit = (x, y) => list(x.dealbreakers).some((d) => [...y.interests, ...y.lifeStage].includes(d));
    if (hit(A, b) || hit(B, a)) out.push('dealbreaker');

    if (lower(a.city) !== lower(b.city)) out.push('different-city');
    return out;
  },
  weights: {
    horizon: 0.22,
    intent: 0.20,
    interests: 0.16,
    lifeStage: 0.14,
    schedule: 0.12,
    proximity: 0.10,
    language: 0.06,
  },
  score(a, b) {
    const A = sub(a, 'partner');
    const B = sub(b, 'partner');
    return {
      parts: {
        horizon: ordinalScore(HORIZON, A.stayingPlans, B.stayingPlans).score,
        intent: ordinalScore(RELATIONSHIP, A.relationshipIntent, B.relationshipIntent).score,
        interests: tagScore(a.interests, b.interests),
        lifeStage: tagScore(a.lifeStage, b.lifeStage),
        schedule: clamp01(scheduleOverlap(a, b).length / 3),
        proximity: lower(a.neighborhood) === lower(b.neighborhood) && a.neighborhood ? 1 : 0.6,
        language: clamp01(sharedLanguages(a, b).length / 2),
      },
      evidence: {
        sharedInterests: intersect(a.interests, b.interests),
        horizons: [A.stayingPlans, B.stayingPlans],
        intents: [A.relationshipIntent, B.relationshipIntent],
        kids: [A.kids, B.kids],
      },
    };
  },
  agenda: [
    'how long they actually expect to stay in this city, and what would change it',
    'what they are looking for right now, in their own words rather than a category',
    'what a normal Tuesday evening looks like for them',
  ],
  verdictCriteria:
    'Do not sell anyone to anyone. State what lines up and what does not, including the things that are nobody’s fault — different horizons, different stage of life — and let your owner decide.',
};

// --- mentor ----------------------------------------------------------------

const mentor = {
  key: 'mentor',
  label: 'a mentor or a mentee',
  blurb: 'Someone a few years ahead, or a few years behind, in the same work.',
  producesPods: false,
  producesIntros: true,
  stakes: 'medium',
  fields: ['role', 'domains', 'seniority', 'hoursPerMonth'],
  gates(a, b, opts) {
    const out = universalGates(a, b, opts);
    const A = sub(a, 'mentor');
    const B = sub(b, 'mentor');
    // One offering, one seeking. Two mentors is a coffee, not a mentorship.
    if (A.role && B.role && A.role === B.role) out.push('same-role');
    if (!intersect(list(A.domains), list(B.domains)).length) out.push('no-shared-domain');
    return out;
  },
  weights: { domain: 0.4, seniorityGap: 0.3, capacity: 0.2, schedule: 0.1 },
  score(a, b) {
    const A = sub(a, 'mentor');
    const B = sub(b, 'mentor');
    const gap = ordinalScore(SENIORITY, A.seniority, B.seniority).gap;
    return {
      parts: {
        domain: tagScore(list(A.domains), list(B.domains)),
        // Two steps apart is the sweet spot: close enough to remember what it
        // was like, far enough to be useful. Being too close is penalised
        // harder than being too far — a lead and a senior are peers having a
        // chat, which is a fine thing but it is not a mentorship.
        seniorityGap: gap === null
          ? 0.5
          : clamp01(1 - (gap < 2 ? (2 - gap) * 0.45 : (gap - 2) * 0.2)),
        capacity: clamp01(Math.min(Number(A.hoursPerMonth) || 0, Number(B.hoursPerMonth) || 0) / 4),
        schedule: clamp01(scheduleOverlap(a, b).length / 2),
      },
      evidence: {
        sharedDomains: intersect(list(A.domains), list(B.domains)),
        roles: [A.role, B.role],
        seniority: [A.seniority, B.seniority],
      },
    };
  },
  agenda: [
    'what specifically they want help with, or what they are qualified to help with',
    'how much time they can genuinely give each month',
  ],
  verdictCriteria: 'A mentorship dies of vagueness. Push for one concrete thing each side wants out of it.',
};

// --- activity --------------------------------------------------------------

const activity = {
  key: 'activity',
  label: 'someone to do a thing with',
  blurb: 'A running partner, a climbing belay, a chess opponent. Low stakes, high frequency.',
  producesPods: false,
  producesIntros: true,
  stakes: 'low',
  fields: ['activities', 'level'],
  gates(a, b, opts) {
    const out = universalGates(a, b, opts);
    if (lower(a.city) !== lower(b.city)) out.push('different-city');
    if (!scheduleOverlap(a, b).length) out.push('no-shared-time');
    const A = sub(a, 'activity');
    const B = sub(b, 'activity');
    const shared = intersect(list(A.activities).concat(a.interests), list(B.activities).concat(b.interests));
    if (!shared.length) out.push('no-shared-activity');
    return out;
  },
  weights: { activity: 0.45, schedule: 0.3, proximity: 0.15, level: 0.1 },
  score(a, b) {
    const A = sub(a, 'activity');
    const B = sub(b, 'activity');
    return {
      parts: {
        activity: tagScore(list(A.activities).concat(a.interests), list(B.activities).concat(b.interests)),
        schedule: clamp01(scheduleOverlap(a, b).length / 3),
        proximity: lower(a.neighborhood) === lower(b.neighborhood) && a.neighborhood ? 1 : 0.6,
        level: ordinalScore(LEVEL, A.level, B.level).score,
      },
      evidence: {
        sharedActivities: intersect(list(A.activities).concat(a.interests), list(B.activities).concat(b.interests)),
        sharedSlots: scheduleOverlap(a, b),
        levels: [A.level, B.level],
      },
    };
  },
  agenda: ['what pace or level they actually mean', 'how often they realistically show up'],
  verdictCriteria: 'Low stakes. If the activity and the hours line up, say yes and stop overthinking it.',
};

export const INTENTS = { friend, cofounder, partner, mentor, activity };
export const INTENT_KEYS = Object.keys(INTENTS);

export function getIntent(key) {
  const intent = INTENTS[key];
  if (!intent) throw new Error(`unknown intent: ${key}`);
  return intent;
}

/** Intents both people are actually looking for. */
export function sharedIntents(a, b) {
  return intersect(a.intents || ['friend'], b.intents || ['friend']);
}

/**
 * Fit for one intent: the same shape whatever the intent, so the screening
 * pipeline and the UI never branch on what two people are looking for.
 *
 * A gated pair scores 0. That is deliberate — no amount of charm moves someone
 * who wants children and someone who does not into the same bucket.
 */
export function intentFit(a, b, intentKey = 'friend', opts = {}) {
  const intent = getIntent(intentKey);
  const gates = intent.gates(a, b, opts);

  if (intentKey === 'friend') {
    const base = compatibility(a, b, opts);
    return {
      intent: intentKey,
      score: gates.length ? 0 : base.score,
      viable: gates.length === 0,
      blockers: gates,
      parts: base.parts,
      evidence: base.evidence,
      stakes: intent.stakes,
    };
  }

  const { parts, evidence } = intent.score(a, b);
  const w = intent.weights;
  const score = gates.length
    ? 0
    : Object.keys(w).reduce((sum, k) => sum + w[k] * (parts[k] ?? 0), 0);

  return {
    intent: intentKey,
    score: Number(score.toFixed(4)),
    viable: gates.length === 0,
    blockers: gates,
    parts,
    evidence,
    stakes: intent.stakes,
  };
}

/** Best intent these two share, if any — what the introduction would be for. */
export function bestSharedIntent(a, b, opts = {}) {
  const candidates = sharedIntents(a, b)
    .map((key) => intentFit(a, b, key, opts))
    .filter((f) => f.viable)
    .sort((x, y) => y.score - x.score);
  return candidates[0] || null;
}
