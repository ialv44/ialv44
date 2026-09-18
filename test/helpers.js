import { normalizeProfile } from '../src/core/profile.js';

let counter = 0;

export const DAY = 86400000;
export const NOW = new Date('2026-06-10T12:00:00Z'); // a Wednesday

export function member(overrides = {}) {
  counter += 1;
  return normalizeProfile({
    id: overrides.id || `m${counter}`,
    displayName: overrides.displayName || `Person${counter}`,
    city: 'Lisbon',
    country: 'Portugal',
    homeCountry: 'Elsewhere',
    languages: [{ code: 'en', level: 'fluent' }],
    interests: ['running'],
    seeking: ['weekly-regulars'],
    availability: [{ day: 'tue', window: 'evening' }],
    arrivedAt: new Date(NOW - 200 * DAY).toISOString().slice(0, 10),
    joinedAt: new Date(NOW - 10 * DAY).toISOString(),
    ...overrides,
  });
}

export function slots(...list) {
  return list.map((s) => {
    const [day, window] = s.split(':');
    return { day, window };
  });
}

export function daysAgo(n, from = NOW) {
  return new Date(from - n * DAY).toISOString();
}
