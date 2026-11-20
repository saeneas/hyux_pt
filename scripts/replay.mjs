// Replays a session file (downloaded at the end of a test session, or from the dev drawer) against the
// running server, so a change to the prompts in scaffold/ can be tried with what a real person said.
//
//   node scripts/replay.mjs <session.json> [--round 1] [--condition adaptive] [--server http://localhost:3000] [--out result.json]
//
// Needs a server with DEV_MODE=true and real models (an OpenAI key). It starts a fresh dev session for the
// same participant, sends the recorded transcripts of the deliberation as if they had just been spoken,
// waits for the plan, and answers each pair with the recorded action, card letter and words. The new
// cards differ from the recorded ones, so a letter now points at a new card: the words carry the
// participant's intent, the letter only keeps the rhythm. When the recorded answers run out, the version
// with the recorded final letter (or A) of the pair on screen is used. The profile is made at the end.
// The result file holds the new plan, every pair and the profile next to what was recorded.
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true);
if (!file) { console.error('usage: node scripts/replay.mjs <session.json> [--round 1] [--condition c] [--server url] [--out file]'); process.exit(1); }
const data = JSON.parse(readFileSync(file, 'utf8'));
if (data.format !== 'hyux-personalize-session/1') { console.error('Not a session file of the personalize branch.'); process.exit(1); }
const roundNo = Number(opt('round', data.replay[0]?.round ?? 1));
const rec = data.replay.find((r) => r.round === roundNo);
if (!rec) { console.error(`No task ${roundNo} in the file.`); process.exit(1); }
const server = opt('server', 'http://localhost:3000');
const outFile = opt('out', file.replace(/\.json$/, `.replay-${roundNo}-${Date.now()}.json`));

let sid = null;
async function call(method, url, body) {
  const res = await fetch(server + url, { method, headers: { 'Content-Type': 'application/json', ...(sid ? { 'X-Session-Id': sid } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const started = Date.now();
const s = await call('POST', '/api/dev/session', { participantId: data.participantId, condition: opt('condition', rec.condition) });
sid = s.id;
// The session plan may put another task first: replay into the first round, which has the same scenario
// in this study.
const round = 1;
log(`Session ${sid.slice(0, 8)} as ${s.participantId}, condition ${opt('condition', rec.condition)}`);

let view = await call('POST', '/api/personal/deliberation/start', { round });
const questions = [view.items.find((x) => x.kind === 'prompt')?.text ?? null];
for (const text of rec.said) {
  view = await call('POST', '/api/personal/deliberation/say', { round, text });
  questions.push([...view.items].reverse().find((x) => x.kind === 'prompt')?.text ?? null);
  log(`said: ${text.slice(0, 70)}…\n  → ${questions.at(-1) ?? ''}`);
}
await call('PUT', '/api/session/state', { state: { progress: { [round]: { taskStartedAt: Date.now() } } } });
let state = await call('POST', '/api/personal/deliberation/finish', { round, reason: 'done' });

async function waitPair() {
  for (;;) {
    await sleep(1500);
    state = await call('POST', '/api/personal/state', { round, seen: true });
    if (state.error) throw new Error(`The server failed: ${state.error}`);
    if (!state.busy && state.comparison && !state.comparison.answered) return;
  }
}
await waitPair();
const plan = (await call('GET', '/api/dev/inspect')).rounds[round].plan;
log(`\nwishes after thinking aloud: ${(plan.brief ?? []).join('; ')}`);

const pairs = [];
const pairOf = () => ({ n: state.comparison.n, aspect: state.comparison.aspect, cards: state.comparison.cards });
for (const r of rec.responses.filter((x) => ['pick', 'neither'].includes(x.action))) {
  const c = state.comparison;
  pairs.push({ ...pairOf(), response: r });
  log(`#${c.n} ${c.aspect}: A ${c.cards[0].lens} | B ${c.cards[1].lens}\n  → ${r.action}${r.card ? ` ${r.card}` : ''}${r.note ? `: ${r.note}` : ''}`);
  const cardId = r.action === 'pick' ? c.cards[r.card === 'B' ? 1 : 0].id : undefined;
  await call('POST', '/api/personal/act', { round, action: r.action === 'pick' && !cardId ? 'neither' : r.action, cardId, note: r.note ?? '' });
  await waitPair();
}
const finalCard = state.comparison.cards[rec.accepted === 'B' ? 1 : 0];
pairs.push({ ...pairOf(), response: { action: 'accept', card: rec.accepted ?? 'A' } });
await call('POST', '/api/personal/accept', { round, cardId: finalCard.id, note: '' });
log(`final: ${finalCard.lens}`);

let profile = null;
for (;;) {
  await sleep(2500);
  const p = await call('POST', '/api/personal/profile', { round });
  if (p.error) throw new Error(`The profile failed: ${p.error}`);
  if (p.profile) { profile = p.profile; break; }
}
log(`\nparameters: ${(profile.parameters ?? []).map((x) => `${x.name}: ${x.value}`).join('; ')}`);

writeFileSync(outFile, JSON.stringify({
  replayedAt: new Date().toISOString(), source: file, round: roundNo, seconds: Math.round((Date.now() - started) / 1000),
  questions, plan, pairs, profile,
  recorded: { plan: data.rounds.find((r) => r.round === roundNo)?.plan ?? null, profile: data.rounds.find((r) => r.round === roundNo)?.profile?.result ?? null },
}, null, 2));
log(`\nwritten: ${outFile}`);
