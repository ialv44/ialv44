import { tuning } from '../config.js';
import { compatibility, blockers, isAnchor } from './compatibility.js';
import { hasViableSlot, quorumFor, buildRitual } from './rituals.js';

/**
 * Thirdplace forms pods of 4–6, not 1:1 matches.
 *
 * One-to-one matching puts the entire weight of a new friendship on two
 * strangers and one awkward coffee. A small group survives one person having a
 * bad week, gives quiet people somewhere to stand, and creates the repeated
 * unplanned contact that adult friendship actually needs.
 */

function meanCompat(candidate, members, opts) {
  if (!members.length) return 0;
  let total = 0;
  for (const m of members) total += compatibility(candidate, m, opts).score;
  return total / members.length;
}

function podMaxSize(members) {
  return Math.min(
    tuning.pod.maxSize,
    ...members.map((m) => m.constraints.maxGroupSize),
  );
}

/** The shared interest that gives a pod something to actually do. */
export function findSpine(members, min = tuning.pod.spineMinMembers) {
  const counts = new Map();
  for (const m of members) {
    for (const tag of new Set(m.interests)) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  const best = [...counts.entries()]
    .filter(([, n]) => n >= Math.min(min, members.length))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best ? { tag: best[0], count: best[1] } : null;
}

export function canAdd(candidate, members, opts = {}) {
  if (members.length >= podMaxSize([...members, candidate])) return { ok: false, reason: 'pod-full' };
  for (const m of members) {
    const b = blockers(candidate, m, opts);
    if (b.length) return { ok: false, reason: b[0], with: m.id };
  }
  const next = [...members, candidate];
  if (!hasViableSlot(next, quorumFor(next.length))) return { ok: false, reason: 'no-quorum-slot' };
  return { ok: true };
}

/**
 * Marginal gain of adding a candidate: how well they fit the people already in
 * the pod, plus small structural bonuses for the two things a pod needs to be
 * self-sustaining — someone who knows the city, and a shared thing to do.
 */
export function marginalGain(candidate, members, opts = {}, now = new Date()) {
  const base = meanCompat(candidate, members, opts);
  let bonus = 0;
  if (!members.some((m) => isAnchor(m, now)) && isAnchor(candidate, now)) bonus += 0.06;
  const spine = findSpine(members, 2);
  if (spine && candidate.interests.includes(spine.tag)) bonus += 0.04;
  return Number((base + bonus).toFixed(4));
}

/**
 * Seeds are chosen by who has been waiting longest and who is hardest to place,
 * not by who is most matchable. Otherwise the easy-to-match keep getting pods
 * and the people who most need one never do.
 */
export function chooseSeed(pool, opts = {}, now = new Date()) {
  const scored = pool.map((m) => {
    const viable = pool.filter((o) => o.id !== m.id && blockers(m, o, opts).length === 0).length;
    const waitingDays = (now - new Date(m.joinedAt || now)) / 86400000;
    return { member: m, viable, waitingDays };
  });
  scored.sort(
    (a, b) =>
      b.waitingDays - a.waitingDays ||
      a.viable - b.viable ||
      a.member.id.localeCompare(b.member.id),
  );
  return scored[0]?.member || null;
}

export function growPod(seed, pool, opts = {}, now = new Date()) {
  const members = [seed];
  const remaining = pool.filter((m) => m.id !== seed.id);
  const maxSize = tuning.pod.maxSize;

  while (members.length < maxSize) {
    let best = null;
    for (const cand of remaining) {
      if (members.some((m) => m.id === cand.id)) continue;
      const check = canAdd(cand, members, opts);
      if (!check.ok) continue;
      const gain = marginalGain(cand, members, opts, now);
      if (!best || gain > best.gain || (gain === best.gain && cand.id < best.cand.id)) {
        best = { cand, gain };
      }
    }
    if (!best || best.gain <= 0) break;
    members.push(best.cand);
    remaining.splice(remaining.findIndex((m) => m.id === best.cand.id), 1);
  }
  return members;
}

function cohesion(members, opts) {
  const pairs = [];
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      pairs.push(compatibility(members[i], members[j], opts).score);
    }
  }
  return pairs.length ? Number((pairs.reduce((a, b) => a + b, 0) / pairs.length).toFixed(4)) : 0;
}

function warningsFor(members, now) {
  const w = [];
  if (!members.some((m) => isAnchor(m, now))) w.push('no-anchor');
  if (!findSpine(members)) w.push('no-shared-spine');
  if (members.length === tuning.pod.minSize) w.push('minimum-size');
  return w;
}

/**
 * Forms as many viable pods as the pool allows, in one pass, and reports
 * exactly why each leftover could not be placed. That "why" is the most useful
 * output here — it tells the agent what to say to the person still waiting.
 */
export function formPods(pool, opts = {}, now = new Date()) {
  let remaining = pool.filter((m) => m.status === 'active');
  const pods = [];
  // Seeds that could not be grown into a pod this round. They are held here
  // rather than dropped, so they still turn up in `leftovers` with a reason —
  // an unplaceable person silently disappearing is the worst failure mode this
  // function has.
  const setAside = [];

  while (remaining.length >= tuning.pod.minSize) {
    const seed = chooseSeed(remaining, opts, now);
    if (!seed) break;
    const members = growPod(seed, remaining, opts, now);

    if (members.length < tuning.pod.minSize) {
      remaining = remaining.filter((m) => m.id !== seed.id);
      setAside.push(seed);
      continue;
    }
    const ritual = buildRitual(members, { now });
    pods.push({
      memberIds: members.map((m) => m.id),
      members,
      cohesion: cohesion(members, opts),
      spine: findSpine(members),
      ritual,
      warnings: warningsFor(members, now),
    });
    const placed = new Set(members.map((m) => m.id));
    remaining = remaining.filter((m) => !placed.has(m.id));
  }

  const leftovers = [...setAside, ...remaining].map((m) => ({
    member: m,
    reason: waitingReason(m, pool, opts),
  }));
  return { pods, leftovers };
}

/**
 * Human-legible explanation of why someone is still waiting.
 *
 * `pool` is everyone in the city; `opts.available` is the subset not already in
 * a pod. The distinction matters: "nobody here suits you" and "the people who
 * suit you are already placed" are completely different messages, and telling
 * someone the first when the second is true is the kind of thing that makes
 * people quietly leave.
 */
export function waitingReason(member, pool, opts = {}) {
  const everyone = pool.filter((m) => m.id !== member.id && m.status === 'active');
  if (!everyone.length) return { code: 'empty-city', detail: 'nobody else here yet', viable: 0 };

  const availableIds = opts.available ? new Set(opts.available.map((m) => m.id)) : null;
  const free = availableIds ? everyone.filter((m) => availableIds.has(m.id)) : everyone;

  const viable = free.filter((o) => blockers(member, o, opts).length === 0).length;

  // The blocker tally is taken over everyone, not just the unplaced: the final
  // branch answers "why does nobody here fit me at all", and the people already
  // in pods are evidence for that too.
  const tally = {};
  let viableAnywhere = 0;
  for (const o of everyone) {
    const b = blockers(member, o, opts);
    if (!b.length) viableAnywhere += 1;
    else tally[b[0]] = (tally[b[0]] || 0) + 1;
  }

  if (viable >= tuning.pod.minSize - 1) {
    return { code: 'timing-conflict', detail: 'compatible people exist but no slot reaches quorum', viable };
  }
  if (viable > 0) {
    return {
      code: 'too-few-people',
      detail: `${viable + 1} people here fit together so far; a pod needs ${tuning.pod.minSize}`,
      viable,
    };
  }

  // Nobody unplaced fits — but is that about them, or just about who is free?
  if (viableAnywhere > 0) {
    return {
      code: 'all-matched',
      detail: `the ${viableAnywhere} people you fit with are already in pods; you are first in line for the next one`,
      viable: 0,
      viableAnywhere,
    };
  }

  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  const map = {
    'different-city': 'nobody in your city yet',
    'no-shared-language': 'no shared language with the people here yet',
    'no-shared-time': 'your free hours do not overlap with anyone yet',
    blocked: 'the remaining people are blocked',
    inactive: 'the other members here are paused',
  };
  return { code: top?.[0] || 'thin-pool', detail: map[top?.[0]] || 'not enough people nearby yet', viable: 0 };
}
