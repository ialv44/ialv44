/**
 * Intent-specific profile fields: the enums, and one normaliser for all of
 * them. A leaf module on purpose — both the profile normaliser and the intent
 * scorers need these, and neither should have to import the other.
 */

export const COMMITMENT = ['exploring', 'nights-weekends', 'part-time', 'full-time'];
export const STAGE = ['idea', 'prototype', 'users', 'revenue'];
export const TIMELINE = ['exploring', '6-months', '3-months', 'now'];
export const EQUITY = ['equal', 'negotiable', 'majority'];
export const RELATIONSHIP = ['casual', 'open-to-serious', 'serious'];
export const HORIZON = ['temporary', 'few-years', 'unsure', 'staying'];
export const KIDS = ['want', 'have', 'dont-want', 'unsure'];
export const AGE_BANDS = ['20s', '30s', '40s', '50s', '60+'];
export const MENTOR_ROLE = ['offering', 'seeking'];
export const SENIORITY = ['junior', 'mid', 'senior', 'lead', 'exec'];
export const LEVEL = ['beginner', 'improver', 'regular', 'competitive'];

const t = {
  enum: (values) => ({ kind: 'enum', values }),
  list: (values = null) => ({ kind: 'list', values }),
  number: (min, max) => ({ kind: 'number', min, max }),
  bool: () => ({ kind: 'bool' }),
};

export const INTENT_FIELDS = {
  cofounder: {
    commitment: t.enum(COMMITMENT),
    stage: t.enum(STAGE),
    timeline: t.enum(TIMELINE),
    domains: t.list(),
    brings: t.list(),
    needs: t.list(),
    equityStance: t.enum(EQUITY),
    runwayMonths: t.number(0, 120),
    priorFounder: t.bool(),
  },
  partner: {
    relationshipIntent: t.enum(RELATIONSHIP),
    stayingPlans: t.enum(HORIZON),
    kids: t.enum(KIDS),
    ageBand: t.enum(AGE_BANDS),
    seekingAgeBands: t.list(AGE_BANDS),
    dealbreakers: t.list(),
  },
  mentor: {
    role: t.enum(MENTOR_ROLE),
    domains: t.list(),
    seniority: t.enum(SENIORITY),
    hoursPerMonth: t.number(0, 40),
  },
  activity: {
    activities: t.list(),
    level: t.enum(LEVEL),
  },
  friend: {},
};

const lower = (v) => String(v ?? '').trim().toLowerCase();

/** Unknown keys are dropped and invalid values become undefined rather than
 *  throwing: this data arrives from a form and from a model, and neither is
 *  trusted. An absent field is treated as "not stated", never as a default. */
export function normalizeIntentProfile(intentKey, raw = {}) {
  const spec = INTENT_FIELDS[intentKey];
  if (!spec) return {};
  const out = {};
  for (const [field, type] of Object.entries(spec)) {
    const v = raw[field];
    if (v === undefined || v === null || v === '') continue;
    switch (type.kind) {
      case 'enum':
        if (type.values.includes(lower(v))) out[field] = lower(v);
        break;
      case 'list': {
        const items = [...new Set((Array.isArray(v) ? v : String(v).split(',')).map(lower))]
          .filter(Boolean)
          .filter((x) => !type.values || type.values.includes(x));
        if (items.length) out[field] = items.slice(0, 20);
        break;
      }
      case 'number': {
        const n = Number(v);
        if (Number.isFinite(n)) out[field] = Math.min(type.max, Math.max(type.min, n));
        break;
      }
      case 'bool':
        out[field] = Boolean(v);
        break;
      default:
        break;
    }
  }
  return out;
}

/** Which declared fields are still blank — what the delegate has to admit it
 *  does not know, and what the owner should be asked for. */
export function missingIntentFields(intentKey, profile = {}) {
  return Object.keys(INTENT_FIELDS[intentKey] || {}).filter((f) => profile[f] === undefined);
}
