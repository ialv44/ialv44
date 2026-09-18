import { DAYS, WINDOWS, SEEKING } from '../config.js';

/**
 * Offline mode. Every agent task has a deterministic twin so Thirdplace keeps
 * working with no API key and during a model outage. The copy is plainer than
 * the model's, but the matching, the rituals and the nudges are unchanged —
 * those live in the deterministic core, not in the agent.
 */

const LANG_NAMES = {
  english: 'en', portuguese: 'pt', spanish: 'es', german: 'de', french: 'fr',
  italian: 'it', dutch: 'nl', polish: 'pl', turkish: 'tr', arabic: 'ar',
  russian: 'ru', ukrainian: 'uk', mandarin: 'zh', chinese: 'zh', japanese: 'ja',
  korean: 'ko', hindi: 'hi', marathi: 'mr', tamil: 'ta', bengali: 'bn',
  greek: 'el', swedish: 'sv', danish: 'da', norwegian: 'no', finnish: 'fi',
  czech: 'cs', romanian: 'ro', hungarian: 'hu', hebrew: 'he', farsi: 'fa', persian: 'fa',
};

const WINDOW_WORDS = {
  morning: 'morning', mornings: 'morning', breakfast: 'morning', early: 'morning',
  lunch: 'midday', lunchtime: 'midday', midday: 'midday', afternoon: 'midday', daytime: 'midday',
  evening: 'evening', evenings: 'evening', dinner: 'evening', 'after work': 'evening',
  night: 'late', nights: 'late', late: 'late',
};

const DAY_WORDS = {
  monday: 'mon', mon: 'mon', tuesday: 'tue', tue: 'tue', tues: 'tue',
  wednesday: 'wed', wed: 'wed', thursday: 'thu', thu: 'thu', thurs: 'thu',
  friday: 'fri', fri: 'fri', saturday: 'sat', sat: 'sat', sunday: 'sun', sun: 'sun',
};

const SEEKING_WORDS = {
  'weekly-regulars': ['regular', 'weekly', 'same people', 'routine', 'group'],
  'language-exchange': ['language', 'practise', 'practice', 'tandem', 'exchange'],
  'activity-partner': ['activity', 'partner', 'run', 'climb', 'gym', 'sport', 'hike'],
  'admin-buddy': ['admin', 'bureaucracy', 'paperwork', 'visa', 'residency', 'tax'],
  'deep-1on1': ['one on one', '1:1', 'close friend', 'deep', 'best friend'],
  'family-friendly': ['kids', 'children', 'family', 'toddler', 'baby'],
};

function splitList(text) {
  return text
    .split(/,|\band\b|\balso\b|;|\//i)
    .map((s) => s.trim().toLowerCase().replace(/^(i (like|love|do|enjoy)|my )\s*/i, ''))
    .filter((s) => s.length > 1 && s.length < 40);
}

/** Split on connectives so "Tuesday evenings and Saturday mornings" does not
 *  become a cross product of four slots. */
function clauses(text) {
  return text
    .split(/[,;]|\band\b|\bbut\b|\balso\b|\bplus\b|\bor\b|\n/i)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

function daysIn(clause) {
  const days = [];
  for (const [word, code] of Object.entries(DAY_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(clause) && !days.includes(code)) days.push(code);
  }
  if (/\bweekend/.test(clause)) for (const d of ['sat', 'sun']) if (!days.includes(d)) days.push(d);
  if (/\bweek ?(day|night)/.test(clause)) {
    for (const d of ['mon', 'tue', 'wed', 'thu']) if (!days.includes(d)) days.push(d);
  }
  return days;
}

function windowsIn(clause) {
  const windows = [];
  for (const [word, code] of Object.entries(WINDOW_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(clause) && !windows.includes(code)) windows.push(code);
  }
  return windows;
}

/**
 * "Tuesday and Thursday evenings" leaves the first clause without a window, so
 * a clause missing one half borrows it from its nearest neighbour that has it.
 */
export function parseAvailability(text) {
  const parsed = clauses(text).map((c) => ({ days: daysIn(c), windows: windowsIn(c) }));
  const nearest = (i, key) => {
    for (let d = 1; d < parsed.length; d += 1) {
      if (parsed[i + d]?.[key]?.length) return parsed[i + d][key];
      if (parsed[i - d]?.[key]?.length) return parsed[i - d][key];
    }
    return [];
  };

  const slots = new Set();
  parsed.forEach((p, i) => {
    const days = p.days.length ? p.days : nearest(i, 'days');
    const windows = p.windows.length ? p.windows : nearest(i, 'windows');
    if (!p.days.length && !p.windows.length) return;
    for (const day of days) for (const window of windows) slots.add(`${day}:${window}`);
  });

  return [...slots].map((s) => {
    const [day, window] = s.split(':');
    return { day, window };
  });
}

function levelIn(clause) {
  if (/native|mother tongue|first language/.test(clause)) return 'native';
  if (/beginner|a bit|a little|basic|learning|trying|some\b/.test(clause)) return 'beginner';
  if (/fluent|well|good|comfortable/.test(clause)) return 'fluent';
  return 'conversational';
}

/** Level words bind to their own clause, so "fluent English, a bit of German"
 *  does not make German fluent. */
export function parseLanguages(text) {
  const out = new Map();
  for (const clause of clauses(text)) {
    const level = levelIn(clause);
    for (const [name, code] of Object.entries(LANG_NAMES)) {
      if (new RegExp(`\\b${name}\\b`).test(clause) && !out.has(code)) out.set(code, { code, level });
    }
  }
  return [...out.values()];
}

export function parseArrived(text, now = new Date()) {
  const t = text.toLowerCase();
  const rel = t.match(/(\d+)\s*(week|month|year)s?\s*ago/);
  if (rel) {
    const n = Number(rel[1]);
    const d = new Date(now);
    if (rel[2] === 'week') d.setDate(d.getDate() - n * 7);
    if (rel[2] === 'month') d.setMonth(d.getMonth() - n);
    if (rel[2] === 'year') d.setFullYear(d.getFullYear() - n);
    return d.toISOString().slice(0, 10);
  }
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  const monthYear = t.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/,
  );
  if (monthYear) {
    const month = [
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december',
    ].indexOf(monthYear[1]);
    return new Date(Date.UTC(Number(monthYear[2]), month, 1)).toISOString().slice(0, 10);
  }
  return null;
}

// [field, question, what to say when the answer did not parse]
const FIELD_ORDER = [
  ['displayName', 'What should the others call you?', 'Just a first name or a nickname is fine.'],
  ['city', 'Which city are you in?', 'I need the city itself — "Lisbon", "Berlin".'],
  ['arrivedAt',
    'Roughly when did you land there? "March 2024" or "8 months ago" is fine.',
    'I could not read a date in that. Try "March 2024", "8 months ago", or "2 years ago".'],
  ['languages',
    'Which languages can you hold a conversation in?',
    'Name the languages themselves — "Portuguese and English", say, and tell me which is native.'],
  ['availability',
    'Which days and times are genuinely free for you most weeks? Say something like "Tuesday evenings and Saturday mornings".',
    'I need a day and a time of day together — "Tuesday evenings", "Saturday mornings", "weekday evenings".'],
  ['interests',
    'What do you actually do with a free evening? Three or four things.',
    'A few things, separated by commas.'],
  ['seeking',
    'What would make this worth it — a standing weekly thing, language practice, someone to do a sport with, or help with the admin side?',
    'Any of those four is fine, or say "a regular weekly thing".'],
  ['neighborhood', 'Which part of the city are you in? A district name is enough.', 'A district or neighbourhood name.'],
  ['homeCountry', 'Where did you move from?', 'The country you moved from.'],
];

function isMissing(profile, field) {
  const v = profile[field];
  if (Array.isArray(v)) return v.length === 0;
  return !v;
}

export function nextMissingField(profile) {
  const found = FIELD_ORDER.find(([field]) => isMissing(profile, field));
  return found ? { field: found[0], question: found[1], clarify: found[2] } : null;
}

export function fieldQuestion(field) {
  const found = FIELD_ORDER.find(([f]) => f === field);
  return found ? { field, question: found[1], clarify: found[2] } : null;
}

/** Applies the last answer to whichever field we asked about, then asks the next. */
export function fallbackOnboarding({ profile, transcript, awaiting = null, now = new Date() }) {
  const lastUser = [...transcript].reverse().find((t) => t.role === 'user')?.text || '';
  const patch = {};

  if (lastUser && awaiting) {
    switch (awaiting) {
      case 'displayName':
        patch.displayName = lastUser.replace(/^(hi,?\s*)?(i'?m|my name is|call me)\s*/i, '').trim().split(/[.,\n]/)[0];
        break;
      case 'city':
        patch.city = lastUser.replace(/^(i (live|am) in|in)\s*/i, '').trim().split(/[.,\n]/)[0];
        break;
      case 'neighborhood':
        patch.neighborhood = lastUser.trim().split(/[.,\n]/)[0];
        break;
      case 'homeCountry':
        patch.homeCountry = lastUser.replace(/^(from|i'?m from)\s*/i, '').trim().split(/[.,\n]/)[0];
        break;
      case 'arrivedAt': {
        const d = parseArrived(lastUser, now);
        if (d) patch.arrivedAt = d;
        break;
      }
      case 'languages': {
        const langs = parseLanguages(lastUser);
        if (langs.length) patch.languages = langs;
        break;
      }
      case 'availability': {
        const av = parseAvailability(lastUser);
        if (av.length) patch.availability = av;
        break;
      }
      case 'interests':
        patch.interests = splitList(lastUser).slice(0, 10);
        break;
      case 'seeking': {
        const t = lastUser.toLowerCase();
        const hits = SEEKING.filter((k) => (SEEKING_WORDS[k] || []).some((w) => t.includes(w)));
        patch.seeking = hits.length ? hits : ['weekly-regulars'];
        break;
      }
      default:
        break;
    }
  }

  const merged = { ...profile, ...patch };
  const missing = FIELD_ORDER.filter(([f]) => isMissing(merged, f)).map(([f]) => f);

  // If we asked for something and still cannot read it, say so and ask again
  // in different words. Repeating the identical question is how a scripted
  // conversation turns into a wall.
  const stillMissing = awaiting && lastUser && isMissing(merged, awaiting);
  if (stillMissing) {
    const asked = fieldQuestion(awaiting);
    return {
      patch,
      reply: asked ? asked.clarify : 'I did not catch that — try putting it another way.',
      missing,
      ready: false,
      awaiting,
      offline: true,
    };
  }

  const next = nextMissingField(merged);
  return {
    patch,
    reply: next
      ? next.question
      : `That's enough to find you a pod in ${merged.city}. I'll look for four or five people whose free hours actually overlap with yours.`,
    missing,
    ready: !['city', 'languages', 'availability'].some((f) => isMissing(merged, f)),
    awaiting: next?.field || null,
    offline: true,
  };
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function fallbackPodIntro({ members, ritual, spine }) {
  const names = members.map((m) => m.displayName);
  const city = members[0]?.city || 'your city';
  const last = names.pop();
  const nameList = names.length ? `${names.join(', ')} and ${last}` : last;
  const spineLine = spine
    ? `${spine.count} of you put down ${spine.tag}.`
    : 'You are a mixed bag, which is fine — the standing time is what does the work.';

  return {
    podName: spine ? `${spine.tag} regulars` : `${ritual.day} regulars`,
    ritualName: `${ritual.day} ${ritual.window}s`,
    why: `${nameList} — all in ${city}, all free ${ritual.day} ${ritual.window}s. ${spineLine} Nobody has to come every week; ${ritual.quorum} of you showing up is enough for it to be worth it.`,
    anchorPrompt:
      'First time: everyone name the one piece of paperwork here that made no sense to you. Fastest way to find out who has been through what.',
    firstStep: `Agree on ${ritual.venue.label} and keep it. Same place every time — that is the whole trick.`,
    memberNotes: members
      .concat(last ? [] : [])
      .map((m) => ({
        memberId: m.id,
        note: `${m.displayName}${m.monthsInCity != null ? `, ${plural(m.monthsInCity, 'month')} in` : ''}${m.interests?.length ? ` — ${m.interests.slice(0, 3).join(', ')}` : ''}`,
      })),
    offline: true,
  };
}

const NUDGE_TEMPLATES = {
  'newcomer-orientation': (f) => ({
    title: `You're in — now the slow part`,
    body: `Nothing is going to happen today. I'm waiting until there are four or five people in ${f.city || 'your city'} whose free hours actually overlap with yours, because a group that can never meet is worse than no group. Meanwhile: go to the same place twice this week. Same cafe, same time. Being recognised is the first step and it doesn't need anyone's permission.`,
    action: 'Pick one place near you and go there twice.',
    tone: 'practical',
  }),
  'still-waiting': (f) => ({
    title: `Still looking — here's the actual holdup`,
    body: `${f.daysWaiting} days in and I haven't put you in a pod. The reason: ${f.detail}. ${
      {
        'timing-conflict':
          'There are people here who suit you, but no single slot works for enough of you at once. One more free window on your side would probably crack it.',
        'no-shared-time':
          'Your free hours land when nobody else is free. One window earlier in the evening would change this on its own.',
        'too-few-people':
          'Nothing is wrong with your profile — the city is just thin here so far.',
        'all-matched':
          'Nothing is wrong with your profile either. The next pod that forms here starts with you.',
      }[f.code] || 'That changes as more people join, and I will tell you the moment it does.'
    }`,
    action: ['timing-conflict', 'no-shared-time'].includes(f.code)
      ? 'Add one more free window if you can.'
      : '',
    tone: 'practical',
  }),
  'pod-welcome': (f) => ({
    title: `Your pod is set`,
    body: `${f.ritual?.day} ${f.ritual?.window}s, ${f.ritual?.venue?.label}. ${f.ritual?.quorum} people is enough for it to count, so nobody has to make every one.`,
    action: 'Agree the exact place, then put it in your calendar as recurring.',
    tone: 'warm',
  }),
  'pod-gap': () => ({
    title: `None of you is the local`,
    body: `Nobody in this pod has been in the city a year. That mostly matters for one thing: nobody knows where to go. Between you, ask around and pick a place — then stop choosing.`,
    action: 'Pick a standing place this week.',
    tone: 'practical',
  }),
  'pre-meetup': (f) => ({
    title: `Tomorrow: ${f.venue?.label || 'the usual'}`,
    body: `Meet-up ${f.meetupNumber}. ${f.quorum} people makes it worth doing. If you can't come, you can't come — the point is that it happens again next time.`,
    action: f.spine
      ? `Bring one thing about ${f.spine.tag} you'd tell a stranger.`
      : 'Bring the strangest thing you have had to do here for paperwork.',
    tone: 'light',
  }),
  'no-show-recovery': (f) => ({
    title: `Is the time wrong?`,
    body: `You've missed ${f.missed}. That is genuinely fine — but if the slot just doesn't work for your week, say so and I'll look at the alternates rather than let it quietly become a thing you used to do.`,
    action: 'Tell me if the time is the problem.',
    tone: 'gentle',
  }),
  'first-1on1': (f) => ({
    title: `You two have done this ${f.coAttends} times now`,
    body: `That's usually the point where a group acquaintance turns into a friend, and it almost always takes one person suggesting something outside the group. Entirely optional.`,
    action: 'One coffee, one of you asks.',
    tone: 'warm',
  }),
  'drift-checkin': (f) => ({
    title: `It's been ${f.daysSinceLast ?? 'a while'} days`,
    body: `Pods go quiet for boring reasons — the slot stopped working, or one person stopped coming and everyone followed. Which one is it here?`,
    action: 'Answer honestly: keep the time, move it, or stop.',
    tone: 'gentle',
  }),
  'reshuffle-offer': (f) => ({
    title: `Want a different time, or different people?`,
    body: `Nothing has happened in ${f.daysSinceLast} days. That isn't anyone's fault — most standing plans die of scheduling, not of people. ${
      f.alternates?.length
        ? `Your next-best slots are ${f.alternates.map((a) => `${a.day} ${a.window}`).join(' and ')}.`
        : 'I can also put you into a new pod.'
    }`,
    action: 'Move the time, or ask me to re-pod you.',
    tone: 'practical',
  }),
  'arrival-milestone': (f) => ({
    title: `${f.milestone}`,
    body: `This is usually where it gets harder, not easier — the novelty has worn off and the admin is done, so what's left is whether you have anyone to see on a Tuesday. If you do, keep it. If you don't, that's the thing to fix, and it is fixable.`,
    action: 'Keep one standing thing in the week.',
    tone: 'warm',
  }),
};

export function fallbackNudge(nudge) {
  const make = NUDGE_TEMPLATES[nudge.kind];
  const base = make
    ? make(nudge.facts || {})
    : { title: 'An update', body: 'Something changed in your pod.', action: '', tone: 'practical' };
  return { ...base, offline: true };
}
