# Thirdplace

**Everyone gets an agent. Your agent screens people with their agent, then brings
you the ones worth your time — and nothing happens until you say yes.**

Built for adults living in a country that is not the one they grew up in, where
starting a social life from zero is the actual problem. The same machinery works
whether you are looking for a friend, a cofounder, a partner, a mentor, or just
someone to run with.

Not a social network, not an events feed, not a swipe deck. Two things:

- **Pods** — groups of four to six with a standing time and a standing kind of
  place, for the ordinary friendship that only comes from repetition.
- **Screened introductions** — for the decisions worth getting right, your
  delegate talks to theirs first, and you read the transcript before you commit
  to anything.

```bash
npm install
npm run demo     # seeds a cohort, forms pods, runs agent screenings, prints the lot
npm start        # http://localhost:3000
npm test
```

It runs with no API key. See [Offline mode](#offline-mode).

---

## How a screened introduction works

```
1. prefilter        hard gates, a fit floor, readiness, cooldown     deterministic
2. screening        delegate  <->  delegate, bounded turns                    agent
3. verdicts         each delegate writes privately, for its owner alone       agent
4. proposal         two recommends, and only two, become a request    deterministic
5. approval         both owners say yes, or nothing happens           deterministic
```

Steps 1, 4 and 5 never touch a model. That is the point: what gets asked, who
gets asked, and what gets revealed are not things a language model should be
deciding.

**The delegate is loyal to one person.** It answers only from their profile. When
it is asked something the profile does not cover, it says so and records the
question — which then comes back to its owner as "your agent needs you to answer
this". An agent that invents a detail to keep a conversation going has destroyed
the only thing it was for.

**Each owner sees only their own agent's verdict** — the headline, the reasons,
the caveats, the open questions, and the full transcript of what the two agents
said. Never the other side's verdict.

**A decline is never attributed.** If they pass, you see exactly what you would
see if the request had timed out. The status field is neutralised, not just the
wording. Without that, every "no" becomes a small social injury and people stop
saying no honestly — which is what makes existing matching products unpleasant.

## Intents

One registry entry adds a whole new thing to be matched on. Nothing else in the
pipeline knows what a cofounder is.

| Intent | Hard gates | What fit means |
|---|---|---|
| `friend` | same city, shared language, overlapping hours | similarity, and a time you can both make |
| `cofounder` | commitment more than one step apart, both want majority, no working overlap | **complementary** skills — two identical engineers score *worse* than an engineer and a seller |
| `partner` | opposite positions on children, outside each other's stated range, casual vs serious, **staying vs leaving** | horizon, intent, then the ordinary things |
| `mentor` | both offering, or no shared domain | a seniority gap of about two steps; too close is a chat, not a mentorship |
| `activity` | no shared activity, no shared hours | the activity, the hours, the level |

The `partner` horizon gate is the expat-specific one. "How long are you actually
staying" is the question that sinks these relationships in month four, so it is
asked in the questionnaire and enforced before anyone's time is spent.

## Why it is built this way

Adult friendship needs three things: proximity, repetition, and unplanned time
together. Apps reliably supply the first and skip the other two. Every design
decision below is an attempt at the other two.

**Groups, not matches.** One-to-one matching puts the whole weight of a new
friendship on two strangers and one awkward coffee. Pods of four to six survive
one person having a bad week, give quiet people somewhere to stand, and produce
the repeated contact that actually turns acquaintances into friends.

**A standing time beats a good match.** The most common way a group of adults
stops existing is not conflict — it is scheduling. So a shared free hour is a
*hard gate* in matching, weighted higher than shared interests, and a pod that
has no slot its quorum can make is never formed at all.

**Quorum, not attendance.** The ritual happens whether or not everyone comes.
Three of five is enough. This removes the RSVP treadmill, the group chat where
everyone waits for someone else to commit, and the guilt that makes people go
quiet instead of saying they are busy.

**Every pod needs an anchor.** At least one member who has been in the city over
a year, because an all-newcomer pod has nobody who knows where to go. When no
anchor is available the pod is flagged rather than silently shipped.

**The app says why.** People without a pod are told the real reason — your free
hours do not overlap with anyone's, the people who suit you are already placed,
there are only three of you in this city. Most apps hide this behind "we're
still looking!". Hiding it is why people leave.

**The agent writes; it does not decide.** Whether to say something is a
deterministic rule. What to say is the model. So a model outage costs Thirdplace
its tone of voice, never its judgement — and nobody gets nudged because a model
felt chatty.

**Screening is rationed on purpose.** One screening per person per run, a turn
budget, a fit floor, a readiness floor, a per-pair cooldown, and a cap per run.
High-stakes intents outrank low-stakes ones in the queue, so a good cofounder
match is never crowded out by a marginally better-scoring coffee.

---

## Architecture

```
src/core/         deterministic, pure, no I/O, no model — the part that decides
  profile.js      normalisation + what one member may see of another
  intent-fields.js the per-intent questionnaire: enums, coercion, what is missing
  intents.js      the registry — gates, scoring and screening agenda per intent
  compatibility.js pairwise fit, and the hard gates that are never traded off
  pods.js         pod formation, and why each leftover is still waiting
  rituals.js      slot ranking, quorum, venue archetypes, next occurrence
  momentum.js     relationship warmth with decay, pod health
  screening.js    who gets screened, whose turn it is, when to stop
  introductions.js the approval gate and every redaction rule
  nudges.js       trigger detection: is there anything worth saying at all

src/agent/        Claude — the part that writes
  client.js       one JSON-shaped call, with refusal/rate-limit/outage handling
  prompts.js      the shared voice, the delegate voice, the output schemas
  delegate.js     one screening turn, and one verdict
  fallback.js     a deterministic twin for every agent task
  delegate-fallback.js  the same, for delegates
  index.js        each task, with its fallback wired in

src/service.js    ties the three together
src/api.js        route table
src/server.js     zero-dependency HTTP + static
public/           vanilla SPA, no build step
```

The only runtime dependency is `@anthropic-ai/sdk`. Storage is a JSON file with
atomic writes and serialised mutations — swap `src/store.js` for a real database
and nothing above it changes.

### How matching works

Seven weighted dimensions produce a pairwise score, and five conditions are hard
gates that a high score can never override:

| Hard gate | Why it is absolute |
|---|---|
| different city | there is no such thing as a remote pod |
| no shared language at conversational level or better | a group where one person cannot follow is not a group |
| no overlapping free hours | the pod would never meet |
| either party blocked | non-negotiable |
| either party inactive | — |

| Dimension | Weight |
|---|---|
| schedule overlap | 0.28 |
| interests | 0.20 |
| what they are looking for | 0.14 |
| social style (energy, planning) | 0.12 |
| language, incl. mutual exchange bonus | 0.10 |
| proximity (same neighbourhood) | 0.09 |
| life stage | 0.07 |

Pods are seeded by **who has waited longest and is hardest to place**, not by who
is most matchable — otherwise the easy-to-match keep getting pods and the people
who most need one never do. Members are then added by marginal fit, subject to
the group still having a slot its quorum can make, the strictest group-size
constraint in the pod, and a small bonus for the pod's first anchor and for
extending its shared interest.

### When the agent speaks

| Trigger | Fires when |
|---|---|
| `newcomer-orientation` | joined this week, no pod yet |
| `still-waiting` | no pod after the first week — with the actual reason |
| `pod-welcome` | a pod is formed |
| `pod-gap` | the pod has no long-term resident |
| `pre-meetup` | 24h before the standing time |
| `no-show-recovery` | two consecutive absences from a live pod |
| `first-1on1` | a pair has co-attended 3+ times and warmth crossed the line |
| `drift-checkin` | 21 days quiet |
| `reshuffle-offer` | 42 days quiet |
| `arrival-milestone` | 3, 6 or 12 months in the city |

Each has a cooldown and de-duplicates against what is already queued. Only the
warmest eligible pair in a pod is nudged towards a coffee per run — suggesting
six coffees at once is how you get zero coffees.

Warmth decays with a 21-day half-life. A one-to-one counts 2.5× a group meet-up.

---

## Offline mode

Without `ANTHROPIC_API_KEY`, every agent task falls back to a deterministic twin:
the onboarding interview becomes a field-by-field script with real parsers for
dates, languages and availability ("Tuesday evenings and Saturday mornings"
parses correctly, and does not become four slots), and the copy comes from
templates. Matching, rituals, momentum and nudge triggers are identical either
way, because none of them live in the agent. The UI labels anything written this
way as `template`.

With a key set, the same tasks go to `claude-opus-5` with adaptive thinking,
strict JSON-schema output and server-side refusal fallbacks. Set it in `.env`
(see `.env.example`) or the environment:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

---

## Safety and privacy

- Profiles hold **no precise location and no contact details** — the finest
  granularity is a district name, and that is also the finest granularity the
  matcher ever needs.
- `publicView()` is the only way member data reaches another member or the
  model, and it honours per-field consent flags.
- Every venue archetype is a public place. First meets never happen at a home.
- A block is symmetric, is a hard gate in matching forever, and **dissolves any
  pod the two shared** rather than making them keep meeting; both are released
  back into the pool and re-matched. Reporting also blocks.
- Nudges never use streaks, guilt or scarcity, and attendance is always optional.
- A delegate sees its own person in full and the other person only through
  `publicView()`. An agent acting for you does not earn you extra access to
  someone else. Dealbreaker lists are never shown to anyone.
- No introduction is made, and no contact is exchanged, without both people
  approving. A decline is indistinguishable from a timeout.

---

## HTTP API

| | |
|---|---|
| `GET /api/overview` | counts, pod health, cities |
| `GET/POST /api/members` | roster / join |
| `GET/PATCH /api/members/:id` | member view (pod, waiting reason, nudges) |
| `POST /api/members/:id/chat` | one turn of the joining conversation |
| `GET /api/pods`, `GET /api/pods/:id` | pods with ritual, momentum, warmth |
| `POST /api/pods/:id/meetups` | record attendance |
| `GET /api/nudges?status=pending` | the queue |
| `POST /api/nudges/:id/resolve` | send or dismiss |
| `GET /api/pairs/:a/:b` | why these two, with the evidence |
| `POST /api/match` / `/api/nudges/run` / `/api/tick` | run the agent |
| `GET /api/intents` | the registry, with field specs for the questionnaire |
| `GET /api/introductions/:memberId` | that person's approval inbox, redacted |
| `POST /api/introductions/:id/respond` | `{memberId, decision: approve\|pass}` |
| `GET /api/screenings`, `/api/screenings/eligible` | what ran, and what would run next |
| `POST /api/screenings/run` | prefilter, screen, propose |
| `GET /api/fit/:a/:b/:intent` | the full breakdown for one pair and one intent |
| `GET /api/readiness/:memberId/:intent` | how much of the questionnaire is answered |
| `POST /api/blocks`, `/api/reports` | safety |
| `POST /api/demo` | reset and seed the demo cohort |

## Tests

`npm test` — 170 tests, no network, no key required. The demo cohort is built
around the cases that matter: a pod that should form, a pod that has quietly
died, someone whose only free hours are late at night, a city with too few
people in it, a cofounder pair whose commitment levels make them a non-starter,
and two people who want the same things but are not staying in the same country.

The privacy rules in `introductions.js` are tested as guarantees rather than as
behaviour — that a verdict cannot leak across, that a delegate's private notes
reach neither owner, and that a decline and a timeout produce byte-identical
views.
