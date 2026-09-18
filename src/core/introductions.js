import { tuning } from '../config.js';
import { daysBetween } from './momentum.js';

/**
 * The approval gate.
 *
 * An agent screening two people is only useful if it ends with the people
 * deciding. So: nothing is introduced until *both* owners say yes, each owner
 * sees only their own agent's verdict, and a decline is never attributed.
 *
 * That last rule is doing more work than it looks. If a decline were visible,
 * every "no" would become a small social injury, and people would stop saying
 * no honestly — which is exactly what makes existing matching products
 * unpleasant. Here, a no reads the same as a timeout.
 */

export const DECISIONS = ['approve', 'pass'];

/** Both delegates have to recommend. One "hold" is not a near-miss to push through. */
export function bothRecommend(verdicts, pairIds) {
  return pairIds.every((id) => verdicts[id]?.verdict === 'recommend');
}

export function proposeIntroduction({ screening, verdicts, now = new Date() }) {
  if (!bothRecommend(verdicts, screening.pairIds)) return null;
  return {
    pairIds: [...screening.pairIds],
    intent: screening.intent,
    screeningId: screening.id,
    verdicts, // stored together, disclosed separately — see viewFor()
    approvals: {},
    status: 'pending',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + tuning.screening.approvalExpiryDays * 86400000).toISOString(),
    resolvedAt: null,
  };
}

export function awaiting(intro) {
  return intro.pairIds.filter((id) => !intro.approvals[id]);
}

export function isExpired(intro, now = new Date()) {
  return intro.status === 'pending' && new Date(intro.expiresAt) <= now;
}

/**
 * Records one owner's decision and resolves the introduction if that settles
 * it. A pass resolves immediately — there is no point making the other person
 * wait out the clock.
 */
export function recordDecision(intro, memberId, decision, { note = '', now = new Date() } = {}) {
  if (!intro.pairIds.includes(memberId)) throw new Error('not a party to this introduction');
  if (intro.status !== 'pending') throw new Error(`introduction already ${intro.status}`);
  if (!DECISIONS.includes(decision)) throw new Error(`unknown decision: ${decision}`);
  if (intro.approvals[memberId]) throw new Error('already decided');

  intro.approvals[memberId] = { decision, note: String(note).slice(0, 500), at: now.toISOString() };

  if (decision === 'pass') {
    intro.status = 'declined';
    intro.resolvedAt = now.toISOString();
  } else if (intro.pairIds.every((id) => intro.approvals[id]?.decision === 'approve')) {
    intro.status = 'approved';
    intro.resolvedAt = now.toISOString();
  }
  return intro;
}

export function expire(intro, now = new Date()) {
  if (!isExpired(intro, now)) return intro;
  intro.status = 'expired';
  intro.resolvedAt = now.toISOString();
  return intro;
}

/**
 * What one party is allowed to see. The other side's verdict never leaves this
 * function, and neither does the identity of whoever said no.
 */
export function viewFor(intro, memberId, { other = null, screening = null, now = new Date() } = {}) {
  if (!intro.pairIds.includes(memberId)) return null;
  const mine = intro.approvals[memberId] || null;

  // `intro.status` distinguishes "declined" from "expired", which is exactly
  // the thing the other person must not be able to tell apart. Only the person
  // who made a decision is shown a status that reveals one was made.
  const visibleStatus = ['declined', 'expired'].includes(intro.status) && mine?.decision !== 'pass'
    ? 'closed'
    : intro.status;

  const base = {
    id: intro.id,
    intent: intent_(intro),
    status: visibleStatus,
    createdAt: intro.createdAt,
    expiresAt: intro.expiresAt,
    yourVerdict: intro.verdicts[memberId] || null,
    yourDecision: mine?.decision || null,
    other,
  };

  if (intro.status === 'pending' && !mine) {
    return {
      ...base,
      stage: 'awaiting-you',
      transcript: screening ? readableTranscript(screening) : [],
      daysLeft: Math.max(0, Math.ceil(daysBetween(now, intro.expiresAt))),
    };
  }
  if (intro.status === 'pending' && mine) {
    return { ...base, stage: 'awaiting-them', transcript: screening ? readableTranscript(screening) : [] };
  }
  if (intro.status === 'approved') {
    return {
      ...base,
      stage: 'introduced',
      transcript: screening ? readableTranscript(screening) : [],
      firstStep: intro.verdicts[memberId]?.suggestedFirstStep || 'Say hello.',
    };
  }

  // Declined or expired. If they passed, this reads exactly the same as a
  // timeout — on purpose. The only person who learns a decision was made is
  // the person who made it.
  return {
    ...base,
    stage: 'closed',
    other: mine?.decision === 'pass' ? other : null,
    note: mine?.decision === 'pass'
      ? 'You passed on this one.'
      : 'This one did not go ahead. It happens for all sorts of reasons and none of them are worth guessing at.',
  };
}

function intent_(intro) {
  return intro.intent;
}

/** The screening transcript, stripped of the delegates' private reasoning. */
export function readableTranscript(screening) {
  return (screening.turns || []).map((t) => ({
    speakerId: t.speakerId,
    message: t.message,
    at: t.at,
  }));
}

/** Everything blocking this person right now, newest first. */
export function pendingFor(introductions, memberId, now = new Date()) {
  return introductions
    .filter((i) => i.pairIds.includes(memberId) && i.status === 'pending' && !i.approvals[memberId] && !isExpired(i, now))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
