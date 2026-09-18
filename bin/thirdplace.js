#!/usr/bin/env node
import { config } from '../src/config.js';
import { Store } from '../src/store.js';
import { seedMembers, seedHistory } from '../src/seed.js';
import { runMatchmaking, runNudges, runScreenings, introductionsFor, tick, overview, podView, agentAvailable } from '../src/service.js';
import { eligiblePairs } from '../src/core/screening.js';
import { startServer } from '../src/server.js';

const [, , cmd = 'serve', ...rest] = process.argv;

const ESC = String.fromCharCode(27);
const bold = (s) => `${ESC}[1m${s}${ESC}[0m`;
const dim = (s) => `${ESC}[2m${s}${ESC}[0m`;

async function main() {
  switch (cmd) {
    case 'serve': {
      const store = await Store.open(config.dbPath);
      if (!store.data.members.length && rest.includes('--seed')) await demo(store, { quiet: true });
      startServer(store);
      break;
    }
    case 'demo': {
      const store = await Store.open(config.dbPath);
      await demo(store);
      break;
    }
    case 'tick': {
      const store = await Store.open(config.dbPath);
      const result = await tick(store);
      console.log(
        `${result.podsCreated} pod(s) formed, ${result.screenings} screening(s) run, `
        + `${result.introductions} introduction(s) proposed, ${result.nudges.length} nudge(s) written.`,
      );
      for (const n of result.nudges) console.log(`  ${dim(n.kind.padEnd(22))} ${n.title}`);
      break;
    }
    case 'reset': {
      const store = await Store.open(config.dbPath);
      store.reset();
      await store.save();
      console.log('Store cleared.');
      break;
    }
    default:
      console.log('Usage: thirdplace <serve [--seed] | demo | tick | reset>');
      process.exitCode = 1;
  }
}

async function demo(store, { quiet = false } = {}) {
  const now = new Date();
  store.reset();
  store.data.members = seedMembers(now);
  await store.save();

  const { created, waiting } = await runMatchmaking(store, { now });
  await store.mutate((d) => d.meetups.push(...seedHistory(store, now)));
  const queued = eligiblePairs(store, { now });
  const screened = await runScreenings(store, { now });
  const nudges = await runNudges(store, { now });

  if (quiet) return;

  const stats = overview(store, { now });
  const agentLine = agentAvailable()
    ? `agent: ${config.model}`
    : 'agent: offline (no ANTHROPIC_API_KEY - using templates)';
  console.log(`\n${bold('Thirdplace demo')}  ${dim(agentLine)}`);
  console.log(dim(`${stats.members} members - ${stats.cities.join(', ')}\n`));

  for (const pod of created) {
    const v = podView(store, pod.id, { now });
    console.log(`${bold(pod.name)}  ${dim(`(${pod.city} - fit ${pod.cohesion})`)}`);
    console.log(`  ${pod.ritual.name} - ${pod.ritual.day} ${pod.ritual.window} (${pod.ritual.time}), ${pod.ritual.venue.label}`);
    console.log(
      `  quorum ${pod.ritual.quorum} of ${pod.memberIds.length}${pod.warnings.length ? dim(`  [${pod.warnings.join(', ')}]`) : ''}`,
    );
    console.log(`  ${dim(pod.why)}`);
    for (const note of pod.memberNotes) console.log(`   - ${note.note}`);
    console.log(`  ${dim(`momentum: ${v.momentum.state} (${v.momentum.held} held, last ${v.momentum.daysSinceLast ?? '-'}d ago)`)}\n`);
  }

  if (waiting.length) {
    console.log(bold('Still waiting'));
    for (const w of waiting) {
      const m = store.member(w.memberId);
      console.log(`  ${m.displayName.padEnd(8)} ${dim(`${w.code} - ${w.detail}`)}`);
    }
    console.log('');
  }

  console.log(bold('Agent screening'));
  console.log(dim(`  the prefilter found ${queued.length} pair(s) worth a conversation; ${screened.length} were screened\n`));
  for (const { screening: sc, introduction } of screened) {
    const names = sc.pairIds.map((x) => store.member(x).displayName);
    console.log(`  ${bold(names.join(' and '))} ${dim(`- ${sc.intent}, fit ${sc.fit.score}`)}`);
    for (const t of sc.turns.slice(0, 2)) {
      console.log(dim(`    ${store.member(t.speakerId).displayName}'s agent: ${truncate(t.message, 110)}`));
    }
    if (sc.turns.length > 2) console.log(dim(`    ... ${sc.turns.length - 2} more turns`));
    for (const mid of sc.pairIds) {
      const v = sc.verdicts[mid];
      console.log(`    -> for ${store.member(mid).displayName}: ${v.verdict.toUpperCase()} ${dim(v.headline)}`);
    }
    console.log(introduction
      ? `    ${bold('waiting on both of them to say yes')}\n`
      : dim('    no introduction - both agents have to recommend\n'));
  }

  const inboxes = store.data.members
    .map((m) => ({ m, pending: introductionsFor(store, m.id, { now }).filter((i) => i.stage === 'awaiting-you') }))
    .filter((x) => x.pending.length);
  if (inboxes.length) {
    console.log(bold('Waiting on a person'));
    for (const { m, pending } of inboxes) {
      for (const i of pending) console.log(`  ${m.displayName.padEnd(8)} ${dim(`${i.intent}:`)} ${i.yourVerdict.headline}`);
    }
    console.log('');
  }

  console.log(bold(`Nudges queued (${nudges.length})`));
  for (const n of nudges) console.log(`  ${dim(n.kind.padEnd(22))} ${n.title}`);
  console.log(`\n${dim(`Run \`npm start\` and open http://localhost:${config.port}`)}\n`);
}

function truncate(text, n) {
  const t = String(text);
  return t.length <= n ? t : `${t.slice(0, n - 1)}...`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
