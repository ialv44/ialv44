import { Store, id } from './store.js';
import { normalizeProfile, publicView, completeness, monthsInCity } from './core/profile.js';
import { compatibility } from './core/compatibility.js';
import { formPods, waitingReason } from './core/pods.js';
import { nextOccurrence } from './core/rituals.js';
import { podMomentum, warmthMap, pairWarmth } from './core/momentum.js';
import { detectNudges } from './core/nudges.js';
import { onboardingTurn, introducePod, writeNudge, agentAvailable } from './agent/index.js';
import { nextMissingField } from './agent/fallback.js';

export { Store, agentAvailable };

export async function joinMember(store, input) {
  const profile = normalizeProfile({ ...input, id: id('mem') });
  // Open with a question and record which field it is for. Without this the
  // member's first answer arrives with nothing to attach it to and is lost.
  const first = nextMissingField(profile);
  profile.onboarding = {
    transcript: first ? [{ role: 'agent', text: first.question, at: profile.joinedAt }] : [],
    awaiting: first?.field || null,
    complete: completeness(profile) >= 0.85,
  };
  await store.mutate((d) => d.members.push(profile));
  return profile;
}

export async function updateMember(store, memberId, patch) {
  return store.mutate((d) => {
    const i = d.members.findIndex((m) => m.id === memberId);
    if (i < 0) throw new Error('member not found');
    const onboarding = d.members[i].onboarding;
    d.members[i] = { ...normalizeProfile(patch, d.members[i]), id: memberId, onboarding };
    return d.members[i];
  });
}

/** One turn of the joining conversation. The agent writes; the core decides. */
export async function chatTurn(store, memberId, text, { now = new Date() } = {}) {
  const member = store.member(memberId);
  if (!member) throw new Error('member not found');
  const onboarding = member.onboarding || { transcript: [], awaiting: null };
  const transcript = [...onboarding.transcript, { role: 'user', text, at: now.toISOString() }];

  const result = await onboardingTurn({
    profile: stripInternal(member),
    transcript,
    awaiting: onboarding.awaiting,
    now,
  });

  return store.mutate((d) => {
    const i = d.members.findIndex((m) => m.id === memberId);
    const merged = normalizeProfile(result.patch || {}, d.members[i]);
    merged.id = memberId;
    merged.onboarding = {
      transcript: [...transcript, { role: 'agent', text: result.reply, at: now.toISOString() }],
      awaiting: result.awaiting,
      complete: Boolean(result.ready),
    };
    d.members[i] = merged;
    return { member: merged, reply: result.reply, missing: result.missing, ready: result.ready, offline: result.offline };
  });
}

function stripInternal(member) {
  const { onboarding, ...rest } = member;
  return rest;
}

/**
 * Forms pods city by city. Cities are matched independently — there is no such
 * thing as a cross-city pod, and mixing the pools would only make the
 * greedy fill worse.
 */
export async function runMatchmaking(store, { now = new Date() } = {}) {
  const pool = store.unpodded().filter((m) => completeness(m) >= 0.5);
  const byCity = new Map();
  for (const m of pool) {
    const key = m.city.toLowerCase();
    if (!byCity.has(key)) byCity.set(key, []);
    byCity.get(key).push(m);
  }

  const created = [];
  const waiting = [];

  for (const [, members] of byCity) {
    const { pods, leftovers } = formPods(members, { blocks: store.data.blocks }, now);
    for (const p of pods) {
      const intro = await introducePod({
        members: p.members,
        ritual: p.ritual,
        spine: p.spine,
        cohesion: p.cohesion,
        warnings: p.warnings,
      });
      const pod = {
        id: id('pod'),
        name: intro.podName,
        city: p.members[0].city,
        memberIds: p.memberIds,
        ritual: { ...p.ritual, name: intro.ritualName, anchorPrompt: intro.anchorPrompt },
        why: intro.why,
        firstStep: intro.firstStep,
        memberNotes: intro.memberNotes,
        spine: p.spine,
        cohesion: p.cohesion,
        warnings: p.warnings,
        status: 'active',
        createdAt: now.toISOString(),
        welcomedAt: null,
        agentOffline: Boolean(intro.offline),
      };
      created.push(pod);
    }
    for (const l of leftovers) waiting.push({ memberId: l.member.id, ...l.reason });
  }

  if (created.length) await store.mutate((d) => d.pods.push(...created));
  return { created, waiting };
}

/** Detect what needs saying, then have the agent say it. */
export async function runNudges(store, { now = new Date(), limit = 50 } = {}) {
  const detected = detectNudges(store, { now }).slice(0, limit);
  const written = [];

  for (const n of detected) {
    const pod = n.podId ? store.pod(n.podId) : null;
    const subject = n.memberId ? store.member(n.memberId) : null;
    const audienceIds = n.pairIds || pod?.memberIds || (n.memberId ? [n.memberId] : []);
    const members = audienceIds.map((mid) => store.member(mid)).filter(Boolean);

    const copy = await writeNudge({ nudge: n, subject, pod, members });
    written.push({
      id: id('ndg'),
      ...n,
      title: copy.title,
      body: copy.body,
      action: copy.action,
      tone: copy.tone,
      agentOffline: Boolean(copy.offline),
      audienceIds,
      status: 'pending',
      createdAt: now.toISOString(),
    });
  }

  if (written.length) {
    await store.mutate((d) => {
      d.nudges.push(...written);
      for (const n of written) {
        if (n.kind === 'pod-welcome') {
          const pod = d.pods.find((p) => p.id === n.podId);
          if (pod) pod.welcomedAt = now.toISOString();
        }
      }
    });
  }
  return written;
}

export async function tick(store, { now = new Date() } = {}) {
  const matched = await runMatchmaking(store, { now });
  const nudges = await runNudges(store, { now });
  return { podsCreated: matched.created.length, waiting: matched.waiting, nudges };
}

export async function recordMeetup(store, { podId, at, attendedIds, note = '' }) {
  const pod = store.pod(podId);
  if (!pod) throw new Error('pod not found');
  const valid = (attendedIds || []).filter((x) => pod.memberIds.includes(x));
  const meetup = {
    id: id('met'),
    podId,
    at: new Date(at || Date.now()).toISOString(),
    attendedIds: valid,
    quorumMet: valid.length >= (pod.ritual?.quorum ?? 3),
    note: String(note).slice(0, 500),
  };
  await store.mutate((d) => d.meetups.push(meetup));
  return meetup;
}

export async function logInteraction(store, { kind, a, b, at }) {
  if (!['one-on-one', 'message'].includes(kind)) throw new Error('unsupported interaction kind');
  const entry = { kind, a, b, at: new Date(at || Date.now()).toISOString() };
  await store.mutate((d) => d.interactions.push(entry));
  return entry;
}

export async function blockMember(store, by, target) {
  await store.mutate((d) => {
    if (!d.blocks.some((x) => x.by === by && x.target === target)) d.blocks.push({ by, target });
    // A block inside a shared pod dissolves the pod rather than forcing them
    // to keep meeting; both get re-matched on the next tick.
    for (const pod of d.pods) {
      if (pod.memberIds.includes(by) && pod.memberIds.includes(target)) {
        pod.status = 'dissolved';
        pod.dissolvedReason = 'block';
      }
    }
  });
  return { by, target };
}

export async function reportMember(store, { by, target, reason }) {
  const report = { id: id('rep'), by, target, reason: String(reason).slice(0, 1000), at: new Date().toISOString(), status: 'open' };
  await store.mutate((d) => d.reports.push(report));
  await blockMember(store, by, target);
  return report;
}

export async function resolveNudge(store, nudgeId, status = 'sent') {
  return store.mutate((d) => {
    const n = d.nudges.find((x) => x.id === nudgeId);
    if (n) n.status = status;
    return n || null;
  });
}

// --- read models ----------------------------------------------------------

export function podView(store, podId, { now = new Date() } = {}) {
  const pod = store.pod(podId);
  if (!pod) return null;
  const members = pod.memberIds.map((mid) => store.member(mid)).filter(Boolean);
  const ctx = { meetups: store.data.meetups, interactions: store.data.interactions, now };
  return {
    ...pod,
    members: members.map((m) => ({ ...publicView(m), monthsInCity: monthsInCity(m, now) })),
    momentum: podMomentum(pod, ctx),
    warmth: warmthMap(pod.memberIds, ctx),
    nextAt: pod.ritual ? nextOccurrence(pod.ritual, now)?.toISOString() : null,
    meetups: store.data.meetups.filter((m) => m.podId === podId).sort((a, b) => new Date(b.at) - new Date(a.at)),
  };
}

export function memberView(store, memberId, { now = new Date() } = {}) {
  const member = store.member(memberId);
  if (!member) return null;
  const pod = store.podOf(memberId);
  return {
    profile: member,
    completeness: completeness(member),
    pod: pod ? podView(store, pod.id, { now }) : null,
    waiting: pod ? null : waitingReason(member, store.data.members, { blocks: store.data.blocks, available: store.unpodded() }),
    nudges: store.data.nudges
      .filter((n) => n.audienceIds?.includes(memberId) && n.status === 'pending')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  };
}

/** Why these two, in the words the app is willing to show them. */
export function explainPair(store, aId, bId, { now = new Date() } = {}) {
  const a = store.member(aId);
  const b = store.member(bId);
  if (!a || !b) return null;
  const compat = compatibility(a, b, { blocks: store.data.blocks });
  const warmth = pairWarmth(aId, bId, {
    meetups: store.data.meetups,
    interactions: store.data.interactions,
    now,
  });
  return { a: publicView(a), b: publicView(b), compat, warmth };
}

export function overview(store, { now = new Date() } = {}) {
  const d = store.data;
  const ctx = { meetups: d.meetups, interactions: d.interactions, now };
  const active = d.pods.filter((p) => p.status === 'active');
  return {
    agentOnline: agentAvailable(),
    members: d.members.length,
    pods: active.length,
    unpodded: store.unpodded().length,
    meetups: d.meetups.length,
    pendingNudges: d.nudges.filter((n) => n.status === 'pending').length,
    podHealth: active.map((p) => ({ id: p.id, name: p.name, ...podMomentum(p, ctx) })),
    cities: [...new Set(d.members.map((m) => m.city).filter(Boolean))],
  };
}
