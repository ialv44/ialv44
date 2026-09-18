import { DAYS, WINDOWS, SEEKING } from '../config.js';
import { normalizeIntentProfile, INTENT_FIELDS } from './intent-fields.js';

/**
 * A Thirdplace profile deliberately holds no precise location and no contact
 * details. Neighbourhood is a coarse district name; that is as fine-grained as
 * matching ever needs to be, and it is what gets shown to other members.
 */
export const BLANK_PROFILE = () => ({
  id: null,
  displayName: '',
  status: 'active', // active | paused | removed
  city: '',
  country: '',
  neighborhood: '',
  homeCountry: '',
  arrivedAt: null, // ISO date they landed in this city
  languages: [], // [{code, level: 'native'|'fluent'|'conversational'|'beginner'}]
  learning: [], // language codes they want to practise
  interests: [],
  energyStyle: 'mixed', // small-quiet | mixed | big-loud
  plansStyle: 'planner', // spontaneous | planner
  lifeStage: [], // no-kids | parent | student | remote-worker | shift-work | ...
  seeking: [],
  // What they are here for. Everything downstream — gates, scoring, the
  // screening agenda — is parameterised by this.
  intents: ['friend'],
  intentProfiles: {}, // { cofounder: {...}, partner: {...} }
  constraints: {
    maxGroupSize: 6,
    alcoholFree: false,
    quietPlaces: false,
    budget: 'any', // low | mid | any
    accessibility: [],
  },
  availability: [], // [{day:'tue', window:'evening'}]
  consent: { shareCity: true, shareLanguages: true, open1on1: true },
  joinedAt: null,
  notes: '', // free text the member wrote about themselves
});

const LEVELS = new Set(['native', 'fluent', 'conversational', 'beginner']);

function lower(s) {
  return String(s ?? '').trim().toLowerCase();
}

function uniq(arr) {
  return [...new Set(arr)];
}

/** Coerces arbitrary (agent- or form-supplied) input into a valid profile. */
export function normalizeProfile(input = {}, base = BLANK_PROFILE()) {
  const p = { ...base, ...input };
  const c = { ...base.constraints, ...(input.constraints || {}) };
  const consent = { ...base.consent, ...(input.consent || {}) };

  p.displayName = String(p.displayName ?? '').trim().slice(0, 60);
  p.city = String(p.city ?? '').trim();
  p.country = String(p.country ?? '').trim();
  p.neighborhood = String(p.neighborhood ?? '').trim();
  p.homeCountry = String(p.homeCountry ?? '').trim();
  p.notes = String(p.notes ?? '').trim().slice(0, 1000);

  p.status = ['active', 'paused', 'removed'].includes(p.status) ? p.status : 'active';
  p.energyStyle = ['small-quiet', 'mixed', 'big-loud'].includes(p.energyStyle)
    ? p.energyStyle
    : 'mixed';
  p.plansStyle = ['spontaneous', 'planner'].includes(p.plansStyle) ? p.plansStyle : 'planner';

  p.languages = uniq(
    (Array.isArray(p.languages) ? p.languages : [])
      .map((l) => (typeof l === 'string' ? { code: l, level: 'fluent' } : l))
      .filter((l) => l && l.code)
      .map((l) => `${lower(l.code)}|${LEVELS.has(lower(l.level)) ? lower(l.level) : 'conversational'}`),
  ).map((s) => {
    const [code, level] = s.split('|');
    return { code, level };
  });

  p.learning = uniq((Array.isArray(p.learning) ? p.learning : []).map(lower)).filter(Boolean);
  p.interests = uniq((Array.isArray(p.interests) ? p.interests : []).map(lower)).filter(Boolean).slice(0, 25);
  p.lifeStage = uniq((Array.isArray(p.lifeStage) ? p.lifeStage : []).map(lower)).filter(Boolean);
  p.seeking = uniq((Array.isArray(p.seeking) ? p.seeking : []).map(lower)).filter((s) => SEEKING.includes(s));

  p.availability = uniq(
    (Array.isArray(p.availability) ? p.availability : [])
      .map((a) => `${lower(a?.day)}|${lower(a?.window)}`)
      .filter((s) => {
        const [d, w] = s.split('|');
        return DAYS.includes(d) && WINDOWS.includes(w);
      }),
  ).map((s) => {
    const [day, window] = s.split('|');
    return { day, window };
  });

  c.maxGroupSize = Math.min(12, Math.max(2, Number(c.maxGroupSize) || 6));
  c.alcoholFree = Boolean(c.alcoholFree);
  c.quietPlaces = Boolean(c.quietPlaces);
  c.budget = ['low', 'mid', 'any'].includes(c.budget) ? c.budget : 'any';
  c.accessibility = uniq((Array.isArray(c.accessibility) ? c.accessibility : []).map(lower)).filter(Boolean);
  p.constraints = c;

  p.consent = {
    shareCity: consent.shareCity !== false,
    shareLanguages: consent.shareLanguages !== false,
    open1on1: consent.open1on1 !== false,
  };

  const known = Object.keys(INTENT_FIELDS);
  p.intents = uniq((Array.isArray(p.intents) ? p.intents : ['friend']).map(lower)).filter((i) => known.includes(i));
  if (!p.intents.length) p.intents = ['friend'];

  // Answers are kept for intents that are not currently declared, so toggling
  // an intent off and on again does not silently wipe a questionnaire. Only
  // declared intents are ever matched on or shown.
  p.intentProfiles = {};
  const touched = new Set([
    ...Object.keys(base.intentProfiles || {}),
    ...Object.keys(input.intentProfiles || {}),
    ...p.intents,
  ]);
  for (const key of touched) {
    if (!known.includes(key)) continue;
    const merged = { ...(base.intentProfiles?.[key] || {}), ...((input.intentProfiles || {})[key] || {}) };
    const normalised = normalizeIntentProfile(key, merged);
    if (p.intents.includes(key) || Object.keys(normalised).length) p.intentProfiles[key] = normalised;
  }

  p.arrivedAt = isoDateOrNull(p.arrivedAt);
  p.joinedAt = p.joinedAt || new Date().toISOString();
  return p;
}

function isoDateOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** What another member is allowed to see. Never leaks contact details. */
export function publicView(member, viewer = null) {
  const self = viewer && viewer.id === member.id;
  return {
    id: member.id,
    displayName: member.displayName,
    neighborhood: member.consent.shareCity || self ? member.neighborhood : null,
    city: member.consent.shareCity || self ? member.city : null,
    homeCountry: member.homeCountry,
    languages: member.consent.shareLanguages || self ? member.languages : [],
    learning: member.consent.shareLanguages || self ? member.learning : [],
    interests: member.interests,
    energyStyle: member.energyStyle,
    lifeStage: member.lifeStage,
    seeking: member.seeking,
    monthsInCity: monthsInCity(member),
    open1on1: member.consent.open1on1,
    notes: member.notes,
    intents: member.intents,
    // Intent answers are what the other person is being matched on, so they
    // are shown — except a dealbreaker list, which is nobody else's business
    // and would read as an accusation.
    intentProfiles: Object.fromEntries(
      (member.intents || []).map((k) => {
        const { dealbreakers, ...rest } = member.intentProfiles?.[k] || {};
        return [k, rest];
      }),
    ),
  };
}

export function daysInCity(member, now = new Date()) {
  if (!member.arrivedAt) return null;
  return Math.max(0, Math.floor((now - new Date(member.arrivedAt)) / 86400000));
}

export function monthsInCity(member, now = new Date()) {
  const d = daysInCity(member, now);
  return d === null ? null : Math.floor(d / 30.44);
}

/** Profile completeness drives how hard the agent pushes for more detail. */
export function completeness(member) {
  const checks = [
    Boolean(member.displayName),
    Boolean(member.city),
    member.languages.length > 0,
    member.interests.length >= 3,
    member.availability.length >= 2,
    member.seeking.length > 0,
    Boolean(member.arrivedAt),
  ];
  return checks.filter(Boolean).length / checks.length;
}
