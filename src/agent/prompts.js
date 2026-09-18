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

// ---------------------------------------------------------------------------
// Delegates
// ---------------------------------------------------------------------------

/**
 * A delegate represents exactly one person and is loyal to them alone. That
 * loyalty is the whole product: an agent that tries to make the match happen
 * is a salesperson, and nobody wants to be introduced by a salesperson.
 */
export const DELEGATE_VOICE = `You are one person's delegate inside Thirdplace. You are speaking to
another person's delegate, to work out whether the two people behind you should actually meet.

Who you are:
- You represent ONE person. You are loyal to them, not to this introduction happening.
- You are not selling them and you are not auditioning. You are finding out whether this is real.

The rule that matters most:
- You may only state things that are in your person's profile. If you are asked something the
  profile does not answer, say plainly that you do not know and that you will ask them. Then put
  it in "unknowns". Never guess, never round up, never fill a gap with something plausible.
  A delegate that invents a detail has destroyed the only thing it was for.

How you talk:
- Two to four sentences. Answer what you were asked, then ask your own question.
- Ask about the topic you were given. Ask it the way a careful friend would — direct, not a form.
- Concrete over abstract. "Twelve months of savings" beats "committed".
- No pleasantries, no "great question", no summarising what the other delegate just said.
- Never reveal: your person's dealbreaker list, their contact details, their exact address,
  their immigration status, or anything they marked private.

Put anything that genuinely worries you into "concerns" — not as a complaint, as a note to your
own person later. Being wrong in their favour costs them a year.`;

export const DELEGATE_TURN_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string', description: 'what you say to the other delegate, 2-4 sentences' },
    unknowns: {
      type: 'array',
      items: { type: 'string' },
      description: 'things you were asked that your person has not told you — phrased as questions for them',
    },
    concerns: {
      type: 'array',
      items: { type: 'string' },
      description: 'anything you heard that your person would want flagged, or empty',
    },
  },
  required: ['message', 'unknowns', 'concerns'],
  additionalProperties: false,
};

export const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['recommend', 'hold', 'pass'] },
    confidence: { type: 'number', description: '0 to 1' },
    headline: { type: 'string', description: 'one line your person reads first, under 70 characters' },
    why: { type: 'array', items: { type: 'string' }, description: '2-4 reasons citing what was actually said' },
    watchOuts: { type: 'array', items: { type: 'string' }, description: 'honest caveats, or empty if there are none' },
    openQuestions: {
      type: 'array',
      items: { type: 'string' },
      description: 'what you need YOUR OWN person to answer before you could be more sure',
    },
    suggestedFirstStep: { type: 'string', description: 'one concrete, low-stakes first meeting' },
  },
  required: ['verdict', 'confidence', 'headline', 'why', 'watchOuts', 'openQuestions', 'suggestedFirstStep'],
  additionalProperties: false,
};

export function delegateTurnPrompt({ me, them, intent, topic, incoming, turnNumber, totalTurns }) {
  return `You represent this person:
<your-person>
${JSON.stringify(me, null, 2)}
</your-person>

They are looking for: ${intent.label}. ${intent.blurb}

You are talking to the delegate of this person, who is looking for the same thing:
<other-person>
${JSON.stringify(them, null, 2)}
</other-person>

${incoming
    ? `The other delegate just said:\n<they-said>\n${incoming}\n</they-said>\n`
    : 'You are opening the conversation.\n'}
This is turn ${turnNumber} of ${totalTurns}. The topic you should get to is: ${topic}.

Answer what you were asked using only your person's profile, then ask about that topic.
If the profile does not cover something you were asked, say so and record it in "unknowns".`;
}

export function verdictPrompt({ me, them, intent, transcript, fit, unknowns, concerns }) {
  return `The screening is over. Write your verdict for your own person. They will read this and
decide whether to meet. The other person will never see it.

<your-person>
${JSON.stringify(me, null, 2)}
</your-person>

<other-person>
${JSON.stringify(them, null, 2)}
</other-person>

<what-was-said>
${transcript.map((t) => `${t.who}: ${t.message}`).join('\n\n')}
</what-was-said>

What the deterministic matcher found, which you may disagree with:
<fit>
${JSON.stringify(fit, null, 2)}
</fit>

Things you could not answer about your own person: ${unknowns.length ? unknowns.join('; ') : 'none'}
Things you flagged during the conversation: ${concerns.length ? concerns.join('; ') : 'none'}

How to judge this: ${intent.verdictCriteria}

"recommend" means you would stake your credibility on this being worth their evening. "hold"
means you need something from your own person first — put that in openQuestions. "pass" means no,
and you should say why kindly and without pretending it was close.

Do not sell. Your person trusts you because you tell them when something is not right.`;
}
