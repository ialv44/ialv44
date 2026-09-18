import path from 'node:path';

export const config = {
  port: Number(process.env.PORT || 3000),
  dbPath: path.resolve(process.env.THIRDPLACE_DB || './data/thirdplace.json'),
  model: process.env.THIRDPLACE_MODEL || 'claude-opus-5',
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || '',
};

/** Tuning constants for the deterministic core. Kept in one place so the
 *  matching behaviour can be reasoned about (and tested) without hunting. */
export const tuning = {
  // Pairwise compatibility weights. They sum to 1.
  weights: {
    schedule: 0.28, // the #1 practical blocker for adult friendship
    interests: 0.20,
    seeking: 0.14,
    socialStyle: 0.12,
    language: 0.10,
    proximity: 0.09,
    lifeStage: 0.07,
  },
  pod: {
    minSize: 4,
    maxSize: 6,
    // A pod needs at least one person who has been in the city a while;
    // an all-newcomer pod has nobody who knows where to go.
    anchorAfterDays: 365,
    // At least this many members must share one interest — the pod's "spine".
    spineMinMembers: 3,
  },
  momentum: {
    halfLifeDays: 21, // warmth decays; friendship is a recency game
    coAttendWeight: 1.0,
    oneOnOneWeight: 2.5,
    messageWeight: 0.15,
    // Pair warmth above this, with enough co-attends, earns a 1:1 suggestion.
    oneOnOneThreshold: 2.2,
    oneOnOneMinCoAttends: 3,
  },
  screening: {
    // Two delegates, three exchanges each. More turns do not find more truth;
    // they just cost more and start inventing.
    maxTurns: 6,
    maxPairsPerRun: 5,
    // Don't re-screen the same two people for the same thing for a month.
    cooldownDays: 30,
    // Below this the deterministic prefilter says no and no model is called.
    minFitToScreen: 0.45,
    // How much of the intent questionnaire must be answered before a delegate
    // has enough to represent someone.
    minReadiness: 0.6,
    // An unanswered introduction goes stale rather than sitting forever.
    approvalExpiryDays: 14,
  },
  nudges: {
    newcomerWindowDays: 7,
    preMeetupHours: 24,
    driftDays: 21,
    reshuffleDays: 42,
    missedInARowForRecovery: 2,
    cooldownDays: 5, // don't send the same nudge kind to the same target twice within
  },
};

export const WINDOWS = ['morning', 'midday', 'evening', 'late'];
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const SEEKING = [
  'weekly-regulars',
  'language-exchange',
  'activity-partner',
  'admin-buddy',
  'deep-1on1',
  'family-friendly',
];
