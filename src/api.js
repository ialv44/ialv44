import {
  joinMember, updateMember, chatTurn, runMatchmaking, runNudges, tick,
  recordMeetup, logInteraction, blockMember, reportMember, resolveNudge,
  podView, memberView, explainPair, overview,
  runScreenings, respondToIntroduction, introductionsFor, expireIntroductions,
} from './service.js';
import { INTENTS, INTENT_KEYS, intentFit } from './core/intents.js';
import { eligiblePairs, intentReadiness, readinessGaps } from './core/screening.js';
import { INTENT_FIELDS } from './core/intent-fields.js';
import { publicView } from './core/profile.js';
import { seedMembers, seedHistory } from './seed.js';

const ok = (body, status = 200) => ({ status, body });
const fail = (status, message) => ({ status, body: { error: message } });

/** Route table: [method, path pattern, handler]. `:name` captures a segment. */
const routes = [
  ['GET', '/api/overview', (store) => ok(overview(store))],

  ['GET', '/api/members', (store) =>
    ok(store.data.members.map((m) => ({
      ...publicView(m),
      status: m.status,
      podId: store.podOf(m.id)?.id || null,
    })))],

  ['POST', '/api/members', async (store, _p, body) => {
    if (!body?.displayName) return fail(400, 'displayName is required');
    return ok(await joinMember(store, body), 201);
  }],

  ['GET', '/api/members/:id', (store, p) =>
    memberView(store, p.id) ? ok(memberView(store, p.id)) : fail(404, 'member not found')],

  ['PATCH', '/api/members/:id', async (store, p, body) => {
    if (!store.member(p.id)) return fail(404, 'member not found');
    return ok(await updateMember(store, p.id, body || {}));
  }],

  ['POST', '/api/members/:id/chat', async (store, p, body) => {
    if (!store.member(p.id)) return fail(404, 'member not found');
    const text = String(body?.text ?? '').trim();
    if (!text) return fail(400, 'text is required');
    return ok(await chatTurn(store, p.id, text.slice(0, 2000)));
  }],

  ['GET', '/api/pods', (store) =>
    ok(store.data.pods.filter((x) => x.status === 'active').map((x) => podView(store, x.id)))],

  ['GET', '/api/pods/:id', (store, p) =>
    podView(store, p.id) ? ok(podView(store, p.id)) : fail(404, 'pod not found')],

  ['POST', '/api/pods/:id/meetups', async (store, p, body) => {
    if (!store.pod(p.id)) return fail(404, 'pod not found');
    return ok(await recordMeetup(store, { podId: p.id, ...body }), 201);
  }],

  ['GET', '/api/nudges', (store, _p, _b, q) =>
    ok(store.data.nudges
      .filter((n) => (q.status ? n.status === q.status : true))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)))],

  ['POST', '/api/nudges/:id/resolve', async (store, p, body) => {
    const n = await resolveNudge(store, p.id, body?.status || 'sent');
    return n ? ok(n) : fail(404, 'nudge not found');
  }],

  ['POST', '/api/interactions', async (store, _p, body) => {
    if (!store.member(body?.a) || !store.member(body?.b)) return fail(400, 'both members must exist');
    return ok(await logInteraction(store, body), 201);
  }],

  ['POST', '/api/blocks', async (store, _p, body) => {
    if (!store.member(body?.by) || !store.member(body?.target)) return fail(400, 'both members must exist');
    return ok(await blockMember(store, body.by, body.target), 201);
  }],

  ['POST', '/api/reports', async (store, _p, body) => {
    if (!store.member(body?.by) || !store.member(body?.target)) return fail(400, 'both members must exist');
    return ok(await reportMember(store, body), 201);
  }],

  ['GET', '/api/pairs/:a/:b', (store, p) => {
    const e = explainPair(store, p.a, p.b);
    return e ? ok(e) : fail(404, 'member not found');
  }],

  ['GET', '/api/intents', () =>
    ok(INTENT_KEYS.map((k) => ({
      key: k,
      label: INTENTS[k].label,
      blurb: INTENTS[k].blurb,
      stakes: INTENTS[k].stakes,
      producesPods: INTENTS[k].producesPods,
      agenda: INTENTS[k].agenda,
      // Field specs so the client can render the questionnaire without
      // duplicating the enums.
      fields: Object.entries(INTENT_FIELDS[k]).map(([name, spec]) => ({ name, ...spec })),
    })))],

  ['GET', '/api/introductions/:memberId', (store, p) =>
    store.member(p.memberId)
      ? ok(introductionsFor(store, p.memberId))
      : fail(404, 'member not found')],

  ['POST', '/api/introductions/:id/respond', async (store, p, body) => {
    const { memberId, decision, note } = body || {};
    if (!store.member(memberId)) return fail(400, 'memberId must be an existing member');
    if (!['approve', 'pass'].includes(decision)) return fail(400, 'decision must be approve or pass');
    try {
      const intro = await respondToIntroduction(store, p.id, memberId, decision, { note });
      return ok(introductionsFor(store, memberId).find((i) => i.id === intro.id));
    } catch (err) {
      return fail(/not found/.test(err.message) ? 404 : 409, err.message);
    }
  }],

  // What the prefilter would spend a screening on, without spending it.
  ['GET', '/api/screenings/eligible', (store) =>
    ok(eligiblePairs(store).map((c) => ({
      ...c,
      names: c.pairIds.map((x) => store.member(x)?.displayName),
    })))],

  ['GET', '/api/screenings', (store) =>
    ok(store.data.screenings.map((sc) => ({
      id: sc.id,
      intent: sc.intent,
      state: sc.state,
      names: sc.pairIds.map((x) => store.member(x)?.displayName),
      fit: sc.fit.score,
      turns: sc.turns.length,
      createdAt: sc.createdAt,
      outcome: sc.pairIds.map((x) => sc.verdicts?.[x]?.verdict).join('/'),
    })))],

  ['POST', '/api/screenings/run', async (store) => {
    const done = await runScreenings(store);
    return ok({
      screened: done.length,
      introduced: done.filter((d) => d.introduction).length,
      results: done.map((d) => ({
        names: d.screening.pairIds.map((x) => store.member(x)?.displayName),
        intent: d.screening.intent,
        verdicts: d.screening.pairIds.map((x) => d.screening.verdicts[x].verdict),
        introduced: Boolean(d.introduction),
      })),
    });
  }],

  ['GET', '/api/readiness/:memberId/:intent', (store, p) => {
    const m = store.member(p.memberId);
    if (!m) return fail(404, 'member not found');
    if (!INTENT_KEYS.includes(p.intent)) return fail(400, 'unknown intent');
    return ok({ readiness: intentReadiness(m, p.intent), gaps: readinessGaps(m, p.intent) });
  }],

  ['GET', '/api/fit/:a/:b/:intent', (store, p) => {
    const a = store.member(p.a);
    const b = store.member(p.b);
    if (!a || !b) return fail(404, 'member not found');
    if (!INTENT_KEYS.includes(p.intent)) return fail(400, 'unknown intent');
    return ok(intentFit(a, b, p.intent, { blocks: store.data.blocks }));
  }],

  ['POST', '/api/match', async (store) => ok(await runMatchmaking(store))],
  ['POST', '/api/nudges/run', async (store) => ok(await runNudges(store))],
  ['POST', '/api/tick', async (store) => ok(await tick(store))],

  ['POST', '/api/demo', async (store) => {
    const now = new Date();
    store.reset();
    store.data.members = seedMembers(now);
    await store.save();
    await runMatchmaking(store, { now });
    await store.mutate((d) => d.meetups.push(...seedHistory(store, now)));
    await runNudges(store, { now });
    return ok(overview(store, { now }), 201);
  }],
];

function match(pattern, pathname) {
  const a = pattern.split('/');
  const b = pathname.split('/');
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export async function handle(store, method, pathname, body = null, query = {}) {
  // Collect every route whose path matches before deciding, so that a GET
  // pattern sitting above the POST for the same path can't shadow it with a 405.
  const allowed = [];
  for (const [m, pattern, fn] of routes) {
    const params = match(pattern, pathname);
    if (!params) continue;
    allowed.push(m);
    if (m !== method) continue;
    try {
      return await fn(store, params, body, query);
    } catch (err) {
      return fail(500, err.message);
    }
  }
  if (allowed.length) return fail(405, `${method} not allowed here; try ${[...new Set(allowed)].join(', ')}`);
  return fail(404, 'no such endpoint');
}

export const routeList = routes.map(([m, p]) => `${m} ${p}`);
