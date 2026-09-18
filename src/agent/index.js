import { askJSON, agentAvailable, AgentUnavailable } from './client.js';
import {
  VOICE,
  PROFILE_SCHEMA,
  POD_INTRO_SCHEMA,
  NUDGE_SCHEMA,
  onboardingPrompt,
  podIntroPrompt,
  nudgePrompt,
} from './prompts.js';
import { fallbackOnboarding, fallbackPodIntro, fallbackNudge, nextMissingField } from './fallback.js';
import { completeness, publicView } from '../core/profile.js';

/**
 * Every task here is written the same way: ask the model, and on any failure
 * fall through to the deterministic twin. The caller never has to know which
 * one answered — except through `offline`, which the UI shows honestly.
 */
async function withFallback(task, fallback) {
  if (!agentAvailable()) return fallback('no-api-key');
  try {
    const result = await task();
    return { ...result, offline: false };
  } catch (err) {
    if (err instanceof AgentUnavailable) return fallback(err.message);
    throw err;
  }
}

export async function onboardingTurn({ profile, transcript, awaiting = null, now = new Date() }) {
  return withFallback(
    async () => {
      const out = await askJSON({
        system: VOICE,
        user: onboardingPrompt({ transcript, profile, completeness: completeness(profile) }),
        schema: PROFILE_SCHEMA,
        effort: 'medium',
      });
      // The model can only ask about something; the next field it needs is
      // still ours to decide, so the fallback can resume the same thread.
      const merged = { ...profile, ...out.patch };
      return { ...out, awaiting: nextMissingField(merged)?.field || null };
    },
    (reason) => ({ ...fallbackOnboarding({ profile, transcript, awaiting, now }), degradedBecause: reason }),
  );
}

export async function introducePod({ members, ritual, spine, cohesion, warnings = [] }) {
  const views = members.map((m) => publicView(m));
  return withFallback(
    () =>
      askJSON({
        system: VOICE,
        user: podIntroPrompt({ members: views, ritual, spine, cohesion, warnings }),
        schema: POD_INTRO_SCHEMA,
        effort: 'high',
      }),
    (reason) => ({ ...fallbackPodIntro({ members: views, ritual, spine }), degradedBecause: reason }),
  );
}

export async function writeNudge({ nudge, subject = null, pod = null, members = [] }) {
  return withFallback(
    () =>
      askJSON({
        system: VOICE,
        user: nudgePrompt({
          nudge,
          subject: subject ? publicView(subject) : null,
          pod,
          members: members.map((m) => publicView(m)),
        }),
        schema: NUDGE_SCHEMA,
        effort: 'low',
      }),
    (reason) => ({ ...fallbackNudge(nudge), degradedBecause: reason }),
  );
}

export { agentAvailable };
