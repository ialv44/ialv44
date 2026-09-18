import { tuning } from '../config.js';

const DAY = 86400000;

export function daysBetween(a, b) {
  return (new Date(b) - new Date(a)) / DAY;
}

/** Warmth is a recency game: what you did three months ago barely counts. */
export function decay(days, halfLife = tuning.momentum.halfLifeDays) {
  if (days <= 0) return 1;
  return 0.5 ** (days / halfLife);
}

export function pairKey(a, b) {
  return [a, b].sort().join('~');
}

/** Turn attendance records into the co-attendance edges they imply. */
export function deriveInteractions(meetups = []) {
  const out = [];
  for (const m of meetups) {
    const ids = [...new Set(m.attendedIds || [])].sort();
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        out.push({ kind: 'co-attend', a: ids[i], b: ids[j], at: m.at, meetupId: m.id });
      }
    }
  }
  return out;
}

const WEIGHT = {
  'co-attend': tuning.momentum.coAttendWeight,
  'one-on-one': tuning.momentum.oneOnOneWeight,
  message: tuning.momentum.messageWeight,
};

/**
 * Warmth for one pair, with the counts that produced it. The counts matter as
 * much as the score — "you have now been in the same room four times" is a
 * reason to suggest a coffee; a decimal is not.
 */
export function pairWarmth(aId, bId, { meetups = [], interactions = [], now = new Date() } = {}) {
  const all = [...deriveInteractions(meetups), ...interactions];
  const key = pairKey(aId, bId);
  const mine = all.filter((i) => pairKey(i.a, i.b) === key);

  let score = 0;
  const counts = { 'co-attend': 0, 'one-on-one': 0, message: 0 };
  let lastAt = null;
  for (const i of mine) {
    const w = WEIGHT[i.kind] ?? 0;
    score += w * decay(daysBetween(i.at, now));
    if (counts[i.kind] !== undefined) counts[i.kind] += 1;
    if (!lastAt || new Date(i.at) > new Date(lastAt)) lastAt = i.at;
  }
  return {
    pair: [aId, bId].sort(),
    score: Number(score.toFixed(4)),
    counts,
    lastAt,
    daysSince: lastAt === null ? null : Math.floor(daysBetween(lastAt, now)),
  };
}

export function readyForOneOnOne(warmth, a, b) {
  if (!a?.consent?.open1on1 || !b?.consent?.open1on1) return false;
  if (warmth.counts['one-on-one'] > 0) return false;
  return (
    warmth.counts['co-attend'] >= tuning.momentum.oneOnOneMinCoAttends &&
    warmth.score >= tuning.momentum.oneOnOneThreshold
  );
}

export function warmthMap(memberIds, ctx) {
  const out = [];
  for (let i = 0; i < memberIds.length; i += 1) {
    for (let j = i + 1; j < memberIds.length; j += 1) {
      out.push(pairWarmth(memberIds[i], memberIds[j], ctx));
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

export function podMeetups(podId, meetups = []) {
  return meetups
    .filter((m) => m.podId === podId)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

/**
 * Pod health. `state` is what the nudge engine acts on; the numbers are what
 * the agent quotes back to the pod when it offers to change something.
 */
export function podMomentum(pod, { meetups = [], now = new Date() } = {}) {
  const mine = podMeetups(pod.id, meetups).filter((m) => new Date(m.at) <= now);
  const size = pod.memberIds.length;
  const held = mine.length;
  const last = mine[mine.length - 1] || null;
  const daysSinceLast = last ? Math.floor(daysBetween(last.at, now)) : null;

  const recent = mine.slice(-4);
  const attendanceRate = recent.length
    ? recent.reduce((s, m) => s + (m.attendedIds?.length || 0) / size, 0) / recent.length
    : 0;

  const quorumHits = recent.filter((m) => (m.attendedIds?.length || 0) >= (pod.ritual?.quorum ?? 3)).length;
  const quorumRate = recent.length ? quorumHits / recent.length : 0;

  const ageDays = Math.floor(daysBetween(pod.createdAt || now, now));
  const recencyScore = daysSinceLast === null ? 0 : decay(daysSinceLast, tuning.momentum.halfLifeDays);
  const score = Number((0.5 * recencyScore + 0.3 * quorumRate + 0.2 * attendanceRate).toFixed(4));

  let state;
  if (held === 0) state = ageDays <= 14 ? 'forming' : 'stalled';
  else if (daysSinceLast >= tuning.nudges.reshuffleDays) state = 'cold';
  else if (daysSinceLast >= tuning.nudges.driftDays) state = 'cooling';
  else state = score >= 0.45 ? 'warm' : 'fragile';

  return { podId: pod.id, held, daysSinceLast, attendanceRate: Number(attendanceRate.toFixed(3)), quorumRate, score, state, ageDays, lastMeetupAt: last?.at || null };
}

/** Consecutive recent meetups a member did not attend (most recent first). */
export function missedInARow(memberId, podId, meetups = [], now = new Date()) {
  const mine = podMeetups(podId, meetups).filter((m) => new Date(m.at) <= now);
  let n = 0;
  for (let i = mine.length - 1; i >= 0; i -= 1) {
    if ((mine[i].attendedIds || []).includes(memberId)) break;
    n += 1;
  }
  return n;
}
