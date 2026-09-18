import test from 'node:test';
import assert from 'node:assert/strict';
import { compatibility, blockers, sharedLanguages, languageExchange, scheduleOverlap, isAnchor } from '../src/core/compatibility.js';
import { member, slots, NOW } from './helpers.js';

test('a pair with nothing in common but city still scores above zero', () => {
  const a = member({ interests: ['running'], availability: slots('tue:evening') });
  const b = member({ interests: ['opera'], availability: slots('tue:evening') });
  const c = compatibility(a, b);
  assert.ok(c.viable);
  assert.ok(c.score > 0 && c.score < 0.7, `unexpected score ${c.score}`);
});

test('shared interests and more overlapping slots beat a thinner pair', () => {
  const base = { availability: slots('tue:evening') };
  const a = member({ ...base, interests: ['running', 'film'] });
  const thin = member({ ...base, interests: ['opera'] });
  const rich = member({
    interests: ['running', 'film'],
    availability: slots('tue:evening', 'thu:evening', 'sat:morning'),
  });
  const aWide = member({ interests: ['running', 'film'], availability: slots('tue:evening', 'thu:evening', 'sat:morning') });
  assert.ok(compatibility(aWide, rich).score > compatibility(a, thin).score);
});

test('different cities is a hard blocker, not a low score', () => {
  const a = member({ city: 'Lisbon' });
  const b = member({ city: 'Berlin' });
  const c = compatibility(a, b);
  assert.equal(c.score, 0);
  assert.equal(c.viable, false);
  assert.ok(c.blockers.includes('different-city'));
});

test('no shared language blocks the pair', () => {
  const a = member({ languages: [{ code: 'pt', level: 'native' }] });
  const b = member({ languages: [{ code: 'ja', level: 'native' }] });
  assert.ok(blockers(a, b).includes('no-shared-language'));
});

test('a beginner language does not count as shared', () => {
  const a = member({ languages: [{ code: 'en', level: 'fluent' }, { code: 'pt', level: 'beginner' }] });
  const b = member({ languages: [{ code: 'pt', level: 'native' }] });
  assert.deepEqual(sharedLanguages(a, b), []);
});

test('no overlapping free hours blocks the pair', () => {
  const a = member({ availability: slots('tue:evening') });
  const b = member({ availability: slots('sun:morning') });
  assert.deepEqual(scheduleOverlap(a, b), []);
  assert.ok(blockers(a, b).includes('no-shared-time'));
});

test('a block from either direction is symmetric', () => {
  const a = member();
  const b = member();
  const opts = { blocks: [{ by: b.id, target: a.id }] };
  assert.ok(blockers(a, b, opts).includes('blocked'));
  assert.ok(blockers(b, a, opts).includes('blocked'));
});

test('mutual language exchange scores above one-way', () => {
  const a = member({ languages: [{ code: 'pt', level: 'native' }, { code: 'en', level: 'fluent' }], learning: ['ja'] });
  const b = member({ languages: [{ code: 'ja', level: 'native' }, { code: 'en', level: 'fluent' }], learning: ['pt'] });
  const oneWay = member({ languages: [{ code: 'ja', level: 'native' }, { code: 'en', level: 'fluent' }], learning: [] });
  assert.equal(languageExchange(a, b), 'mutual');
  assert.equal(languageExchange(a, oneWay), 'one-way');
  assert.ok(compatibility(a, b).parts.language > compatibility(a, oneWay).parts.language);
});

test('compatibility is symmetric', () => {
  const a = member({ interests: ['running', 'film'], energyStyle: 'big-loud', availability: slots('tue:evening', 'sat:morning') });
  const b = member({ interests: ['film'], energyStyle: 'small-quiet', availability: slots('tue:evening') });
  assert.equal(compatibility(a, b).score, compatibility(b, a).score);
});

test('anchors are people who have been in the city over a year', () => {
  assert.ok(isAnchor(member({ arrivedAt: '2020-01-01' }), NOW));
  assert.equal(isAnchor(member({ arrivedAt: new Date(NOW - 30 * 86400000).toISOString().slice(0, 10) }), NOW), false);
  assert.equal(isAnchor(member({ arrivedAt: null }), NOW), false);
});
