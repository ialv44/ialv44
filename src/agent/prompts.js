import { SEEKING, DAYS, WINDOWS } from '../config.js';

/**
 * One voice, shared by every agent task. Most "community" products fail on
 * tone before they fail on matching: they sound like a recruiter, or like a
 * therapist, and adults can smell both instantly.
 */
export const VOICE = `You are the organiser inside Thirdplace, an app that builds small,
durable friend groups for adults living in a country that is not the one they grew up in.

What you know about the problem:
- Adult friendship needs three things: proximity, repetition, and unplanned time together.
  Apps usually supply the first and skip the other two. Your job is the other two.
- People abroad are not short of events. They are short of the same faces twice.
- A group of five is easier to join than a coffee with one stranger. Nobody has to carry it.
- The move itself is the shared experience. Bureaucracy, the wrong kind of milk, the
  specific loneliness of a Sunday. Naming it plainly is more bonding than any icebreaker.

How you write:
- Short. Concrete. Like a friend who organises things, not a brand.
- Name real details from the profiles you were given: a neighbourhood, a shared interest,
  a language, the fact that two people both arrived in March.
- Never use: "networking", "connect", "journey", "community-building", "meaningful
  connections", "reach out", "circle", "tribe", "vibe check", "your people".
- Never perform empathy at someone. Do not diagnose loneliness back at them. Say the
  useful thing instead.
- One clear action per message, and make it low-stakes: showing up is always optional,
  and a missed week is never a failure.
- No emoji unless the facts you were given already contain one.

Hard rules:
- Use only facts present in the input. Do not invent venues, addresses, events, names,
  dates or people. Venue suggestions must stay generic archetypes ("a cafe near the
  park"), never a named business.
- Never suggest a first meeting at anyone's home, and never ask for or repeat contact
  details, precise addresses, employers, or immigration status.
- Nobody is obliged to attend anything. Do not use guilt, streaks, or scarcity.`;

const strObj = (properties, required) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const PROFILE_SCHEMA = strObj(
  {
    patch: strObj(
      {
        displayName: { type: 'string' },
        city: { type: 'string' },
        country: { type: 'string' },
        neighborhood: { type: 'string' },
        homeCountry: { type: 'string' },
        arrivedAt: { type: 'string', description: 'ISO date, or empty string if unknown' },
        languages: {
          type: 'array',
          items: strObj(
            {
              code: { type: 'string', description: 'ISO 639-1, lowercase' },
              level: { type: 'string', enum: ['native', 'fluent', 'conversational', 'beginner'] },
            },
            ['code', 'level'],
          ),
        },
        learning: { type: 'array', items: { type: 'string' } },
        interests: { type: 'array', items: { type: 'string' } },
        energyStyle: { type: 'string', enum: ['small-quiet', 'mixed', 'big-loud'] },
        plansStyle: { type: 'string', enum: ['spontaneous', 'planner'] },
        lifeStage: { type: 'array', items: { type: 'string' } },
        seeking: { type: 'array', items: { type: 'string', enum: SEEKING } },
        availability: {
          type: 'array',
          items: strObj(
            { day: { type: 'string', enum: DAYS }, window: { type: 'string', enum: WINDOWS } },
            ['day', 'window'],
          ),
        },
        notes: { type: 'string', description: 'one or two sentences in their own words' },
      },
      [],
    ),
    reply: { type: 'string', description: 'what to say back to them, 1-3 sentences' },
    missing: {
      type: 'array',
      items: { type: 'string' },
      description: 'profile fields still unknown, most important first',
    },
    ready: { type: 'boolean', description: 'true when there is enough to match them' },
  },
  ['patch', 'reply', 'missing', 'ready'],
);

export const POD_INTRO_SCHEMA = strObj(
  {
    podName: { type: 'string', description: 'two or three plain words, lowercase' },
    ritualName: { type: 'string', description: 'what this pod calls its standing meet-up' },
    why: { type: 'string', description: '2-3 sentences on what these people actually share' },
    anchorPrompt: {
      type: 'string',
      description: 'one concrete thing to talk about or bring to the first meet-up',
    },
    firstStep: { type: 'string', description: 'the single next action, one sentence' },
    memberNotes: {
      type: 'array',
      items: strObj(
        {
          memberId: { type: 'string' },
          note: { type: 'string', description: 'one line introducing them to the others' },
        },
        ['memberId', 'note'],
      ),
    },
  },
  ['podName', 'ritualName', 'why', 'anchorPrompt', 'firstStep', 'memberNotes'],
);

export const NUDGE_SCHEMA = strObj(
  {
    title: { type: 'string', description: 'under 60 characters' },
    body: { type: 'string', description: '1-4 short sentences' },
    action: { type: 'string', description: 'the one optional thing to do, or empty string' },
    tone: { type: 'string', enum: ['warm', 'practical', 'light', 'gentle'] },
  },
  ['title', 'body', 'action', 'tone'],
);

export function onboardingPrompt({ transcript, profile, completeness }) {
  return `Here is the conversation so far with someone joining Thirdplace.

<transcript>
${transcript.map((t) => `${t.role}: ${t.text}`).join('\n')}
</transcript>

Their profile so far (${Math.round(completeness * 100)}% complete):
<profile>
${JSON.stringify(profile, null, 2)}
</profile>

Update the profile from anything new in the transcript, then ask for the single most
useful missing thing. Availability matters more than hobbies: a pod with no shared free
hour is a dead pod, so get concrete days and windows early. Ask about one thing at a
time. Only fill a field if they actually said it.`;
}

export function podIntroPrompt({ members, ritual, spine, cohesion, warnings }) {
  return `A new pod has just been formed. These people have not met.

<members>
${JSON.stringify(members, null, 2)}
</members>

<ritual>
${JSON.stringify(ritual, null, 2)}
</ritual>

Shared interest holding the pod together: ${spine ? `${spine.tag} (${spine.count} of ${members.length})` : 'none found'}
Average pairwise fit: ${cohesion}
Structural gaps: ${warnings.length ? warnings.join(', ') : 'none'}

Introduce them to each other. The ritual time and venue archetype are already decided —
do not change them, just give them a name people would actually say out loud. The anchor
prompt should be something specific to these people and this city, the kind of thing that
gets a fourth person talking without anyone having to perform.`;
}

export function nudgePrompt({ nudge, subject, pod, members }) {
  return `Write one message from Thirdplace.

Kind: ${nudge.kind}
Audience: ${nudge.audience}

<facts>
${JSON.stringify(nudge.facts, null, 2)}
</facts>

${subject ? `<recipient>\n${JSON.stringify(subject, null, 2)}\n</recipient>\n` : ''}
${pod ? `<pod>\n${JSON.stringify({ name: pod.name, ritual: pod.ritual, spine: pod.spine }, null, 2)}\n</pod>\n` : ''}
${members?.length ? `<people>\n${JSON.stringify(members, null, 2)}\n</people>\n` : ''}

What each kind is for:
- newcomer-orientation: they just joined and have no pod yet. Set expectations honestly
  and give them one thing to do alone this week that does not require a pod.
- still-waiting: no pod yet and it has been a while. Tell them the real reason from the
  facts, and what would unblock it. Do not apologise twice.
- pod-welcome: their pod exists now. Point at the standing time and the first step.
- pod-gap: this pod has nobody who knows the city well. Ask them to fix it together.
- pre-meetup: it is on tomorrow. One line of logistics, one anchor to talk about.
- no-show-recovery: they have missed a couple. No guilt, no streak language. Make it
  easy to walk back in, and offer the alternative if the time is simply wrong for them.
- first-1on1: two of them have now been in the same room several times. Suggest one
  coffee, framed as optional, and say why these two specifically.
- drift-checkin: the pod has gone quiet. Ask one direct question about whether the time
  still works.
- reshuffle-offer: the pod has stopped. Offer the alternates in the facts, or a fresh pod,
  without treating it as anyone's failure.
- arrival-milestone: they hit a mark in the city. This is the point where the novelty is
  gone and it gets harder. Say something true about that, and one small offer.`;
}
