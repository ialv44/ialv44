import { askJSON, agentAvailable, AgentUnavailable } from './client.js';
import {
  DELEGATE_VOICE,
  DELEGATE_TURN_SCHEMA,
  VERDICT_SCHEMA,
  delegateTurnPrompt,
  verdictPrompt,
} from './prompts.js';
import { fallbackDelegateTurn, fallbackVerdict } from './delegate-fallback.js';
import { publicView } from '../core/profile.js';
import { getIntent } from '../core/intents.js';
import { tuning } from '../config.js';

async function withFallback(task, fallback) {
  if (!agentAvailable()) return fallback('no-api-key');
  try {
    return { ...(await task()), offline: false };
  } catch (err) {
    if (err instanceof AgentUnavailable) return fallback(err.message);
    throw err;
  }
}

/**
 * The delegate sees its own person in full, and the other person only through
 * publicView — the same redaction any member gets. An agent acting for you
 * does not earn you extra access to someone else.
 */
function selfView(member, intentKey) {
  const { onboarding, consent, constraints, ...rest } = member;
  return {
    ...rest,
    intentProfile: member.intentProfiles?.[intentKey] || {},
    constraints,
  };
}

export async function delegateTurn({ me, them, intentKey, topic, topicIndex = 0, incoming, turnNumber }) {
  const intent = getIntent(intentKey);
  return withFallback(
    () =>
      askJSON({
        system: DELEGATE_VOICE,
        user: delegateTurnPrompt({
          me: selfView(me, intentKey),
          them: publicView(them),
          intent,
          topic,
          incoming,
          turnNumber,
          totalTurns: tuning.screening.maxTurns,
        }),
        schema: DELEGATE_TURN_SCHEMA,
        effort: 'medium',
      }),
    (reason) => ({ ...fallbackDelegateTurn({ me, them, intentKey, topic, topicIndex, incoming }), degradedBecause: reason }),
  );
}

export async function delegateVerdict({ me, them, intentKey, transcript, fit, unknowns = [], concerns = [] }) {
  const intent = getIntent(intentKey);
  const result = await withFallback(
    () =>
      askJSON({
        system: DELEGATE_VOICE,
        user: verdictPrompt({
          me: selfView(me, intentKey),
          them: publicView(them),
          intent,
          transcript,
          fit,
          unknowns,
          concerns,
        }),
        schema: VERDICT_SCHEMA,
        effort: 'high',
      }),
    (reason) => ({ ...fallbackVerdict({ me, them, intentKey, fit, unknowns, intent }), degradedBecause: reason }),
  );

  // A verdict is acted on automatically, so clamp rather than trust.
  return {
    ...result,
    confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
    verdict: ['recommend', 'hold', 'pass'].includes(result.verdict) ? result.verdict : 'hold',
  };
}
