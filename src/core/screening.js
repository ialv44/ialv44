import { tuning } from '../config.js';
import { intentFit, getIntent, sharedIntents } from './intents.js';
import { missingIntentFields, INTENT_FIELDS } from './intent-fields.js';
import { daysBetween } from './momentum.js';
import { pairKey } from './momentum.js';

/**
 * Agent-to-agent screening — the deterministic half.
 *
 * This module decides *who* gets screened, *whose turn* it is, and *when to
 * stop*. The delegates only supply the words. Keeping the control flow here
 * means the conversation can never run away: the turn budget, the cooldown and
 * the pair cap are enforced outside the model.
 */

export const SCREENING_STATES = ['running', 'complete', 'abandoned'];

/** A delegate can only represent someone it knows enough about. */
export function intentReadiness(member, intentKey) {
  const declared = Object.keys(INTENT_FIELDS[intentKey] || {});
  if (!declared.length) {
    // The friend intent has no extra questionnaire; the base profile is it.
    const have = [member.city, member.availability.length, member.interests.length, member.languages.length];
    return have.filter(Boolean).length / have.length;
  }
  const missing = missingIntentFields(intentKey, member.intentProfiles?.[intentKey] || {});
  return (declared.length - missing.length) / declared.length;
}

export function readinessGaps(member, intentKey) {
  return missingIntentFields(intentKey, member.intentProfiles?.[intentKey] || {});
}

function screeningKey(aId, bId, intentKey) {
  return `${pairKey(aId, bId)}|${intentKey}`;
}

/**
 * Pairs worth spending a screening on, best first.
 *
 * Everything that can be decided without a model is decided here: hard gates,
 * a fit floor, readiness on both sides, and whether these two have already been
 * through this recently. Only what survives costs anything.
 */
export function eligiblePairs(store, { now = new Date(), limit = tuning.screening.maxPairsPerRun } = {}) {
  const d = store.data;
  const members = d.members.filter((m) => m.status === 'active');
  const opts = { blocks: d.blocks };

  const done = new Map();
  for (const s of d.screenings || []) done.set(screeningKey(s.pairIds[0], s.pairIds[1], s.intent), s);
  const introduced = new Set(
    (d.introductions || []).map((i) => screeningKey(i.pairIds[0], i.pairIds[1], i.intent)),
  );

  const out = [];
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      const a = members[i];
      const b = members[j];
      for (const intentKey of sharedIntents(a, b)) {
        const key = screeningKey(a.id, b.id, intentKey);

        // Already introduced, or already in flight, or screened recently.
        if (introduced.has(key)) continue;
        const prior = done.get(key);
        if (prior) {
          if (prior.state === 'running') continue;
          if (daysBetween(prior.createdAt, now) < tuning.screening.cooldownDays) continue;
        }

        const fit = intentFit(a, b, intentKey, opts);
        if (!fit.viable || fit.score < tuning.screening.minFitToScreen) continue;

        const readiness = Math.min(intentReadiness(a, intentKey), intentReadiness(b, intentKey));
        if (readiness < tuning.screening.minReadiness) continue;

        // A well-matched cofounder or partner screening is worth more than a
        // slightly better-scoring friend screening: it is the expensive
        // decision, and the one a person most wants a second opinion on.
        const stakesWeight = { high: 1, medium: 0.85, low: 0.7 }[getIntent(intentKey).stakes] ?? 0.7;
        out.push({
          pairIds: [a.id, b.id].sort(),
          intent: intentKey,
          fit,
          readiness,
          stakes: getIntent(intentKey).stakes,
          priority: Number((fit.score * readiness * stakesWeight).toFixed(4)),
        });
      }
    }
  }

  // One screening per person per run: nobody should wake up to four of these,
  // and a person in two at once cannot be represented consistently.
  const claimed = new Set();
  return out
    .sort((x, y) => y.priority - x.priority || x.pairIds.join().localeCompare(y.pairIds.join()))
    .filter((p) => {
      if (claimed.has(p.pairIds[0]) || claimed.has(p.pairIds[1])) return false;
      claimed.add(p.pairIds[0]);
      claimed.add(p.pairIds[1]);
      return true;
    })
    .slice(0, limit);
}

export function openScreening({ pairIds, intent, fit, now = new Date() }) {
  return {
    pairIds: [...pairIds].sort(),
    intent,
    fit: { score: fit.score, viable: fit.viable, blockers: fit.blockers, parts: fit.parts, evidence: fit.evidence },
    agenda: getIntent(intent).agenda,
    turns: [],
    state: 'running',
    createdAt: now.toISOString(),
    completedAt: null,
  };
}

/** Deterministic alternation, starting with whoever sorts first. */
export function nextSpeaker(screening) {
  if (isComplete(screening)) return null;
  return screening.pairIds[screening.turns.length % 2];
}

export function listener(screening, speakerId) {
  return screening.pairIds.find((id) => id !== speakerId);
}

export function isComplete(screening) {
  return screening.turns.length >= tuning.screening.maxTurns;
}

/**
 * Which agenda item this turn should push on.
 *
 * The two sides are offset from each other, so they are never asking the same
 * question on the same turn — between them they cover the whole agenda instead
 * of covering half of it twice.
 */
export function currentTopic(screening, speakerId = null) {
  const agenda = screening.agenda || [];
  if (!agenda.length) return null;
  const speaker = speakerId ?? nextSpeaker(screening);
  const offset = Math.max(0, screening.pairIds.indexOf(speaker));
  const round = Math.floor(screening.turns.length / 2);
  return agenda[(round + offset) % agenda.length];
}

export function topicIndex(screening, speakerId) {
  const agenda = screening.agenda || [];
  if (!agenda.length) return 0;
  const offset = Math.max(0, screening.pairIds.indexOf(speakerId));
  return (Math.floor(screening.turns.length / 2) + offset) % agenda.length;
}

export function lastMessageTo(screening, memberId) {
  for (let i = screening.turns.length - 1; i >= 0; i -= 1) {
    if (screening.turns[i].speakerId !== memberId) return screening.turns[i];
  }
  return null;
}

/** Everything the delegates could not answer, which is the profile's to-do list. */
export function unknownsFor(screening, memberId) {
  return [...new Set(screening.turns.filter((t) => t.speakerId === memberId).flatMap((t) => t.unknowns || []))];
}

export function concernsFor(screening, memberId) {
  return [...new Set(screening.turns.filter((t) => t.speakerId === memberId).flatMap((t) => t.concerns || []))];
}
