import { tuning } from '../config.js';
import { daysInCity } from './profile.js';
import { waitingReason } from './pods.js';
import { podMomentum, warmthMap, readyForOneOnOne, missedInARow, daysBetween } from './momentum.js';
import { nextOccurrence } from './rituals.js';

/**
 * Deterministic trigger detection. The agent writes the words; this decides
 * whether there is anything worth saying at all. Keeping that split means a
 * model outage degrades tone, never judgement — and nobody gets spammed
 * because a model felt chatty.
 */

export const NUDGE_KINDS = [
  'newcomer-orientation',
  'still-waiting',
  'pod-welcome',
  'pod-gap',
  'pre-meetup',
  'no-show-recovery',
  'first-1on1',
  'drift-checkin',
  'reshuffle-offer',
  'arrival-milestone',
];

const MILESTONES = [
  { days: 90, label: 'three months in' },
  { days: 180, label: 'six months in' },
  { days: 365, label: 'one year in' },
];

function targetKey(n) {
  return [n.kind, n.podId || '', n.memberId || '', (n.pairIds || []).join('~')].join('|');
}

/** Cooldown + de-duplication against nudges already in the store. */
function suppressed(candidate, existing, now) {
  const key = targetKey(candidate);
  return existing.some((n) => {
    if (targetKey(n) !== key) return false;
    if (n.status === 'pending') return true;
    return daysBetween(n.createdAt, now) < tuning.nudges.cooldownDays;
  });
}

export function detectNudges(store, { now = new Date() } = {}) {
  const d = store.data;
  const ctx = { meetups: d.meetups, interactions: d.interactions, now };
  const out = [];

  const push = (n) => {
    const candidate = { dueAt: now.toISOString(), ...n };
    if (!suppressed(candidate, d.nudges, now)) out.push(candidate);
  };

  // --- People without a pod ------------------------------------------------
  for (const m of store.unpodded()) {
    const waited = daysBetween(m.joinedAt, now);
    if (waited <= tuning.nudges.newcomerWindowDays) {
      push({
        kind: 'newcomer-orientation',
        audience: 'member',
        memberId: m.id,
        facts: {
          daysSinceJoined: Math.floor(waited),
          daysInCity: daysInCity(m, now),
          city: m.city,
          interests: m.interests.slice(0, 5),
        },
      });
    } else {
      push({
        kind: 'still-waiting',
        audience: 'member',
        memberId: m.id,
        facts: {
          daysWaiting: Math.floor(waited),
          ...waitingReason(m, d.members, { blocks: d.blocks, available: store.unpodded() }),
        },
      });
    }
  }

  // --- Pods ----------------------------------------------------------------
  for (const pod of d.pods) {
    if (pod.status && pod.status !== 'active') continue;
    const momentum = podMomentum(pod, ctx);

    if (!pod.welcomedAt) {
      push({ kind: 'pod-welcome', audience: 'pod', podId: pod.id, facts: { spine: pod.spine, ritual: pod.ritual } });
    }

    if ((pod.warnings || []).includes('no-anchor')) {
      push({
        kind: 'pod-gap',
        audience: 'pod',
        podId: pod.id,
        facts: { gap: 'no-anchor', detail: 'nobody in this pod has been in the city a year' },
      });
    }

    if (pod.ritual) {
      const next = nextOccurrence(pod.ritual, now);
      const hoursAway = (next - now) / 3600000;
      if (hoursAway > 0 && hoursAway <= tuning.nudges.preMeetupHours) {
        push({
          kind: 'pre-meetup',
          audience: 'pod',
          podId: pod.id,
          dueAt: next.toISOString(),
          facts: {
            at: next.toISOString(),
            venue: pod.ritual.venue,
            quorum: pod.ritual.quorum,
            meetupNumber: momentum.held + 1,
            spine: pod.spine,
          },
        });
      }
    }

    if (momentum.state === 'cooling' || momentum.state === 'stalled') {
      push({ kind: 'drift-checkin', audience: 'pod', podId: pod.id, facts: momentum });
    }
    if (momentum.state === 'cold') {
      push({
        kind: 'reshuffle-offer',
        audience: 'pod',
        podId: pod.id,
        facts: { ...momentum, alternates: pod.ritual?.alternates || [] },
      });
    }

    // Members quietly dropping out of an otherwise-alive pod.
    if (momentum.held > 0) {
      for (const mid of pod.memberIds) {
        const missed = missedInARow(mid, pod.id, d.meetups, now);
        if (missed >= tuning.nudges.missedInARowForRecovery) {
          push({
            kind: 'no-show-recovery',
            audience: 'member',
            memberId: mid,
            podId: pod.id,
            facts: { missed, podHeld: momentum.held, state: momentum.state },
          });
        }
      }
    }

    // Pairs who have shared enough rooms to earn a coffee of their own.
    // Only the warmest eligible pair per pod per run — suggesting six coffees
    // at once is how you get zero coffees.
    const eligible = warmthMap(pod.memberIds, ctx).filter((w) => {
      const a = store.member(w.pair[0]);
      const b = store.member(w.pair[1]);
      return a && b && readyForOneOnOne(w, a, b);
    });
    if (eligible[0]) {
      const w = eligible[0];
      push({
        kind: 'first-1on1',
        audience: 'pair',
        podId: pod.id,
        pairIds: w.pair,
        facts: { coAttends: w.counts['co-attend'], warmth: w.score, alsoEligible: eligible.length - 1 },
      });
    }
  }

  // --- Milestones in the city ---------------------------------------------
  for (const m of d.members) {
    if (m.status !== 'active') continue;
    const inCity = daysInCity(m, now);
    if (inCity === null) continue;
    const hit = MILESTONES.find((ms) => inCity >= ms.days && inCity < ms.days + 3);
    if (hit) {
      push({
        kind: 'arrival-milestone',
        audience: 'member',
        memberId: m.id,
        facts: { milestone: hit.label, days: inCity, homeCountry: m.homeCountry, city: m.city },
      });
    }
  }

  return out;
}
