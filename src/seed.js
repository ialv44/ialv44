import { normalizeProfile } from './core/profile.js';
import { id } from './store.js';

const ago = (now, days) => new Date(now - days * 86400000).toISOString();
const agoDate = (now, days) => ago(now, days).slice(0, 10);

/**
 * A demo cohort with the shapes that matter: two pods that should form, one
 * person whose only free hours are late at night, and a city with too few
 * people in it. If the matcher is wrong, this cohort shows it.
 */
export function seedMembers(now = new Date()) {
  const L = (p) => ({ city: 'Lisbon', country: 'Portugal', ...p });

  const raw = [
    L({
      displayName: 'Ana', neighborhood: 'Graça', homeCountry: 'Brazil',
      arrivedAt: agoDate(now, 900), joinedAt: ago(now, 40),
      languages: [{ code: 'pt', level: 'native' }, { code: 'en', level: 'fluent' }],
      learning: ['de'], interests: ['running', 'film', 'cooking'],
      energyStyle: 'mixed', plansStyle: 'planner', lifeStage: ['no-kids', 'remote-worker'],
      seeking: ['weekly-regulars', 'activity-partner'],
      availability: [{ day: 'tue', window: 'evening' }, { day: 'thu', window: 'evening' }, { day: 'sat', window: 'morning' }],
    }),
    L({
      displayName: 'Mikkel', neighborhood: 'Alfama', homeCountry: 'Denmark',
      arrivedAt: agoDate(now, 120), joinedAt: ago(now, 38),
      languages: [{ code: 'en', level: 'native' }, { code: 'da', level: 'native' }, { code: 'pt', level: 'beginner' }],
      learning: ['pt'], interests: ['running', 'photography', 'film'],
      energyStyle: 'small-quiet', plansStyle: 'planner', lifeStage: ['no-kids', 'remote-worker'],
      seeking: ['weekly-regulars', 'activity-partner'],
      availability: [{ day: 'tue', window: 'evening' }, { day: 'sat', window: 'morning' }],
    }),
    L({
      displayName: 'Priya', neighborhood: 'Arroios', homeCountry: 'India',
      arrivedAt: agoDate(now, 200), joinedAt: ago(now, 36),
      languages: [{ code: 'en', level: 'native' }, { code: 'mr', level: 'native' }],
      learning: ['pt'], interests: ['running', 'bouldering', 'cooking'],
      energyStyle: 'mixed', plansStyle: 'spontaneous', lifeStage: ['no-kids'],
      seeking: ['weekly-regulars', 'activity-partner', 'language-exchange'],
      availability: [{ day: 'tue', window: 'evening' }, { day: 'thu', window: 'evening' }, { day: 'sun', window: 'morning' }],
    }),
    L({
      displayName: 'Tom', neighborhood: 'Graça', homeCountry: 'United Kingdom',
      arrivedAt: agoDate(now, 75), joinedAt: ago(now, 30),
      languages: [{ code: 'en', level: 'native' }, { code: 'es', level: 'conversational' }],
      learning: ['pt'], interests: ['running', 'board games', 'film'],
      energyStyle: 'small-quiet', plansStyle: 'planner', lifeStage: ['no-kids', 'remote-worker'],
      seeking: ['weekly-regulars', 'admin-buddy'],
      availability: [{ day: 'tue', window: 'evening' }, { day: 'wed', window: 'evening' }],
    }),
    L({
      displayName: 'Chiara', neighborhood: 'Alfama', homeCountry: 'Italy',
      arrivedAt: agoDate(now, 45), joinedAt: ago(now, 28),
      languages: [{ code: 'it', level: 'native' }, { code: 'en', level: 'fluent' }],
      learning: ['pt'], interests: ['running', 'cooking', 'photography'],
      energyStyle: 'big-loud', plansStyle: 'spontaneous', lifeStage: ['no-kids', 'student'],
      seeking: ['weekly-regulars', 'language-exchange'],
      availability: [{ day: 'tue', window: 'evening' }, { day: 'fri', window: 'evening' }, { day: 'sat', window: 'midday' }],
    }),

    L({
      displayName: 'Rui', neighborhood: 'Campo de Ourique', homeCountry: 'Portugal',
      arrivedAt: agoDate(now, 1400), joinedAt: ago(now, 26),
      languages: [{ code: 'pt', level: 'native' }, { code: 'en', level: 'fluent' }],
      learning: [], interests: ['cooking', 'food', 'chess'],
      energyStyle: 'mixed', plansStyle: 'planner', lifeStage: ['parent'],
      seeking: ['weekly-regulars', 'language-exchange', 'family-friendly'],
      availability: [{ day: 'sat', window: 'midday' }, { day: 'sun', window: 'midday' }],
      constraints: { maxGroupSize: 6, alcoholFree: false, quietPlaces: false, budget: 'mid' },
    }),
    L({
      displayName: 'Yuki', neighborhood: 'Estrela', homeCountry: 'Japan',
      arrivedAt: agoDate(now, 60), joinedAt: ago(now, 24),
      languages: [{ code: 'ja', level: 'native' }, { code: 'en', level: 'conversational' }],
      learning: ['pt', 'en'], interests: ['cooking', 'food', 'photography'],
      energyStyle: 'small-quiet', plansStyle: 'planner', lifeStage: ['no-kids'],
      seeking: ['language-exchange', 'weekly-regulars'],
      availability: [{ day: 'sat', window: 'midday' }, { day: 'sun', window: 'midday' }],
      constraints: { maxGroupSize: 5, alcoholFree: true, quietPlaces: true, budget: 'low' },
    }),
    L({
      displayName: 'Nadia', neighborhood: 'Campo de Ourique', homeCountry: 'Egypt',
      arrivedAt: agoDate(now, 300), joinedAt: ago(now, 22),
      languages: [{ code: 'ar', level: 'native' }, { code: 'en', level: 'fluent' }, { code: 'pt', level: 'conversational' }],
      learning: ['pt'], interests: ['cooking', 'food', 'hiking'],
      energyStyle: 'mixed', plansStyle: 'planner', lifeStage: ['parent'],
      seeking: ['weekly-regulars', 'family-friendly', 'admin-buddy'],
      availability: [{ day: 'sat', window: 'midday' }, { day: 'sat', window: 'morning' }],
      constraints: { maxGroupSize: 6, alcoholFree: true, quietPlaces: false, budget: 'low' },
    }),
    L({
      displayName: 'Dawit', neighborhood: 'Estrela', homeCountry: 'Ethiopia',
      arrivedAt: agoDate(now, 150), joinedAt: ago(now, 20),
      languages: [{ code: 'en', level: 'fluent' }, { code: 'pt', level: 'beginner' }],
      learning: ['pt'], interests: ['cooking', 'chess', 'football'],
      energyStyle: 'mixed', plansStyle: 'spontaneous', lifeStage: ['no-kids', 'student'],
      seeking: ['weekly-regulars', 'language-exchange'],
      availability: [{ day: 'sat', window: 'midday' }, { day: 'wed', window: 'evening' }],
    }),

    // Free only when almost nobody else is — should surface as a timing conflict,
    // not as "no matches".
    L({
      displayName: 'Bea', neighborhood: 'Arroios', homeCountry: 'Spain',
      arrivedAt: agoDate(now, 30), joinedAt: ago(now, 18),
      languages: [{ code: 'es', level: 'native' }, { code: 'en', level: 'fluent' }],
      learning: ['pt'], interests: ['film', 'music', 'photography'],
      energyStyle: 'big-loud', plansStyle: 'spontaneous', lifeStage: ['shift-work'],
      seeking: ['weekly-regulars'],
      availability: [{ day: 'mon', window: 'late' }, { day: 'tue', window: 'late' }],
    }),

    // Too few people in this city yet.
    { displayName: 'Ola', city: 'Berlin', country: 'Germany', neighborhood: 'Neukölln', homeCountry: 'Poland',
      arrivedAt: agoDate(now, 90), joinedAt: ago(now, 16),
      languages: [{ code: 'pl', level: 'native' }, { code: 'en', level: 'fluent' }, { code: 'de', level: 'conversational' }],
      learning: ['de'], interests: ['cycling', 'techno', 'cooking'],
      energyStyle: 'big-loud', plansStyle: 'spontaneous', lifeStage: ['no-kids'],
      seeking: ['weekly-regulars', 'language-exchange'],
      availability: [{ day: 'thu', window: 'evening' }, { day: 'sun', window: 'midday' }] },
    { displayName: 'Hassan', city: 'Berlin', country: 'Germany', neighborhood: 'Wedding', homeCountry: 'Syria',
      arrivedAt: agoDate(now, 600), joinedAt: ago(now, 12),
      languages: [{ code: 'ar', level: 'native' }, { code: 'de', level: 'fluent' }, { code: 'en', level: 'conversational' }],
      learning: [], interests: ['cycling', 'cooking', 'chess'],
      energyStyle: 'mixed', plansStyle: 'planner', lifeStage: ['parent'],
      seeking: ['weekly-regulars', 'family-friendly'],
      availability: [{ day: 'thu', window: 'evening' }, { day: 'sun', window: 'midday' }] },
    { displayName: 'Marta', city: 'Berlin', country: 'Germany', neighborhood: 'Neukölln', homeCountry: 'Brazil',
      arrivedAt: agoDate(now, 20), joinedAt: ago(now, 6),
      languages: [{ code: 'pt', level: 'native' }, { code: 'en', level: 'fluent' }],
      learning: ['de'], interests: ['cycling', 'film'],
      energyStyle: 'mixed', plansStyle: 'spontaneous', lifeStage: ['no-kids', 'remote-worker'],
      seeking: ['weekly-regulars', 'admin-buddy'],
      availability: [{ day: 'thu', window: 'evening' }] },
  ];

  return raw.map((r) => {
    const p = normalizeProfile({ ...r, id: id('mem') });
    p.onboarding = { transcript: [], awaiting: null, complete: true };
    return p;
  });
}

/** Past attendance, so momentum and the drift nudges have real history. */
export function seedHistory(store, now = new Date()) {
  const meetups = [];
  const pods = store.data.pods.filter((p) => p.status === 'active');

  pods.forEach((pod, podIndex) => {
    // First pod is healthy; the second has quietly stalled.
    const weeks = podIndex === 0 ? [28, 21, 14, 7] : [49, 42];
    for (const daysBack of weeks) {
      const ids = pod.memberIds;
      // Attendance thins out for the stalling pod and for one persistent no-show.
      const attended =
        podIndex === 0
          ? ids.filter((_, i) => !(i === ids.length - 1 && daysBack <= 14))
          : ids.slice(0, Math.max(3, ids.length - 2));
      meetups.push({
        id: id('met'),
        podId: pod.id,
        at: ago(now, daysBack),
        attendedIds: attended,
        quorumMet: attended.length >= (pod.ritual?.quorum ?? 3),
        note: '',
      });
    }
  });

  // A pod cannot have met before it existed: backdate creation to just before
  // its first seeded meet-up so momentum reads coherently.
  for (const pod of pods) {
    const mine = meetups.filter((m) => m.podId === pod.id);
    if (!mine.length) continue;
    const earliest = mine.reduce((a, b) => (new Date(a.at) < new Date(b.at) ? a : b));
    pod.createdAt = ago(new Date(earliest.at).getTime(), 7);
    pod.welcomedAt = pod.createdAt;
  }

  return meetups;
}
