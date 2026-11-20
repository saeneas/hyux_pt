// /api/personal: the 'personal' interaction mode (branch personalize). The logic itself (every prompt,
// the strategy catalog, the deliberation conditions) lives in scaffold/ and is read on every call; this
// file sends it, holds the state and defines the shape of every answer.
//
//   Deliberate  POST /deliberation/start   { round }          condition, intro, current question, items
//               POST /deliberation/say     { round, text }    a recording (transcript) → next question
//               POST /deliberation/finish  { round, reason }  ends the step; planning starts in the background
//   Compare     POST /state                { round }          the public state (polled while a job runs)
//               POST /act                  { round, action, cardId?, note? }
//                                          action: pick | neither → the next pair (background)
//               POST /accept               { round, cardId }  the final text; the profile starts in the background
//   Profile     POST /profile              { round }          the profile (starts it if needed)
//   Export      GET  /export                                  the session as a file (config.personal.offerExport):
//               everything said and chosen, the plans, cards and profiles, and a replay section that
//               scripts/replay.mjs can run against changed prompts
//
// Stored with the session (rounds[round].personal):
//   { condition, deliberation: { startedAt, finishedAt, finishReason, items: [{ kind: 'prompt' | 'said', text,
//     focus?, at }] }, plan: { approach, open, brief } (as first made), brief, approach, settled, open,
//     comparisons: [{ n, aspect, mode, question, final, cards: [{ id, lens, why, text }], brief, open,
//     createdAt, shownAt, response: { action, cardId, note, at } }], accepted: { cardId, text, at },
//     job: { kind, startedAt, error? }, profile: { evidence, result, measures, createdAt } }
// session.profile holds the latest profile, which the profile call of the next task builds on.
// The steps are lean on purpose: one small-model call per pair, with the task, the brief (the writer's
// wishes so far), the aspects, the chosen version and the latest words. No history.
// The browser gets the pair and its headline only; brief, aspects and approach are logged and shown in
// the dev drawer.
import { Router } from 'express';
import { requireSession } from '../middleware/session.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { cleanResponse } from '../../public/js/core/cleanResponse.js';
import * as scaffold from '../services/scaffold.js';

const MAX_CHARS = 4000;
const clean = (v) => String(v ?? '').trim();
const words = (s) => (clean(s).match(/\S+/g) ?? []).length;

// ----- answer shapes -----
const str = { type: 'string' };
const num = { type: 'number' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items) => ({ type: 'array', items });
const enm = (values) => ({ type: 'string', enum: values });

const ADAPTIVE_SCHEMA = obj({ question: str, focus: str });
// One answer shape for the first pair and every next one: the writer's wishes so far, the aspects
// settled and still open (general first), the aspect of this pair and two whole versions.
const CARD = obj({ lens: str, text: str });
const STEP_SCHEMA = obj({
  brief: arr(str),
  approach: str,
  settled: arr(str),
  open: arr(str),
  aspect: str,
  mode: enm(['confirm', 'probe', 'alert']),
  final: { type: 'boolean' },
  cards: arr(CARD),
});
const EVIDENCE_SCHEMA = obj({
  observations: arr(obj({ kind: enm(['said', 'chose', 'behaviour']), what: str, quote: str, source: str, about: str })),
});
const PROFILE_SCHEMA = obj({ parameters: arr(obj({ name: str, value: str, confidence: num })) });

export function personalRoutes(app) {
  const { config, store, logger, ai, tasksById } = app;
  const P = config.personal;
  const r = Router();
  const limit = rateLimit({
    name: 'chat',
    windowMs: config.limits.rateLimit.windowSeconds * 1000,
    max: config.limits.rateLimit.chatPerWindow,
    key: (req) => req.study.id,
  });
  // A job that started longer ago than this was lost (a server restart) and may run again.
  const staleMs = (P.timeoutSeconds * 2 + 30) * 1000;
  const running = (job) => job && !job.error && Date.now() - Date.parse(job.startedAt) < staleMs;

  function parse(req, res) {
    const session = req.study;
    const round = req.body?.round;
    if (!Number.isInteger(round) || round < 1 || round > session.plan.length) { res.status(400).json({ error: 'bad_round' }); return null; }
    const key = String(round);
    const roundData = (session.rounds[key] ??= { taskId: session.plan[round - 1], turns: [] });
    const p = (roundData.personal ??= { condition: session.dev?.condition ?? P.deliberation.condition, deliberation: null, comparisons: [] });
    return { session, round, key, roundData, p, task: tasksById.get(roundData.taskId) };
  }
  const save = (session, key, roundData) => store.update(session, (s) => { s.rounds[key] = roundData; });

  // One structured call with the model and effort of its kind (config.personal.calls). With
  // logging.modelCalls every call is logged in full (prompt file, input, answer, tokens, time) to the
  // session's log in logs/, which git ignores.
  async function call(kind, promptName, content, schema, log) {
    const c = P.calls[kind];
    const instructions = await scaffold.prompt(promptName);
    const started = Date.now();
    try {
      const out = await ai.structured({
        kind, instructions, input: [{ role: 'user', content }], schema,
        model: c.model, reasoningEffort: c.reasoningEffort, maxOutputTokens: c.maxOutputTokens, hedgeAfterSeconds: 0,
        signal: AbortSignal.timeout(P.timeoutSeconds * 1000),
      });
      const latencyMs = Date.now() - started;
      if (config.logging.modelCalls) log?.write('server.personal.call', { kind, prompt: `${promptName}.md`, model: c.model, effort: c.reasoningEffort, latencyMs, usage: out.usage ?? null, input: content, output: out.data });
      return { ...out, latencyMs, model: c.model };
    } catch (e) {
      if (config.logging.modelCalls) log?.write('server.personal.call', { kind, prompt: `${promptName}.md`, model: c.model, effort: c.reasoningEffort, latencyMs: Date.now() - started, input: content, error: e.message });
      throw e;
    }
  }

  // ----- what every call reads -----
  const taskText = (task) => `Task:\n${task?.task ?? ''}\n\nWhat to write: ${task?.deliverable || 'the text the task asks for'}.\n\nSituation (the only source of facts):\n${task?.situation ?? ''}`;
  const transcript = (p) => (p.deliberation?.items ?? []).map((x) => (x.kind === 'prompt' ? `[Question shown: ${x.text}]` : `Writer: ${x.text}`)).join('\n') || '(The writer said nothing.)';
  // Seconds left in the comparisons and how many pairs that allows.
  function budget(session, round, task) {
    const startedAt = session.state?.progress?.[round]?.taskStartedAt;
    const total = (task?.timeLimitMinutes ?? 8) * 60;
    const used = startedAt ? Math.max(0, (Date.now() - startedAt) / 1000) : 0;
    const secondsLeft = Math.max(0, Math.round(total - used));
    return { secondsLeft, pairsLeft: Math.max(0, Math.floor(secondsLeft / P.secondsPerComparison)) };
  }
  // The whole path, for the profile only (the steps see the brief and the latest choice, no history).
  const history = (p) => p.comparisons.map((c) => {
    const resp = c.response;
    const said = resp ? (resp.action === 'pick' ? `Chose ${resp.cardId === c.cards[0].id ? 'A' : 'B'}` : 'Neither fits') : 'Not answered';
    return `Comparison ${c.n} (aspect: ${c.aspect}): A "${c.cards[0].lens}" | B "${c.cards[1].lens}". ${said}${resp?.note ? `, saying: "${resp.note}"` : resp ? ', without words' : ''}.`;
  }).join('\n') || '(none)';

  // ----- public state -----
  // What the participant sees: the pair and its headline. The path (brief, aspects, approach) stays in
  // the dev drawer. previous: the version chosen last, so the cards can mark what changed since.
  function publicState(p) {
    const current = p.comparisons.at(-1) ?? null;
    const before = [...p.comparisons].reverse().find((c) => c !== current && c.response?.action === 'pick');
    return {
      phase: p.accepted ? 'accepted' : current ? 'compare' : p.deliberation?.finishedAt ? 'planning' : 'deliberate',
      busy: running(p.job) ? p.job.kind : null,
      error: p.job?.error ?? null,
      comparison: current ? {
        n: current.n, aspect: current.aspect, final: Boolean(current.final),
        cards: current.cards.map(({ id, lens, text }) => ({ id, lens, text })), answered: Boolean(current.response),
        previous: before ? before.cards.find((c) => c.id === before.response.cardId)?.text ?? null : null,
      } : null,
      count: p.comparisons.length,
      accepted: p.accepted?.cardId ?? null,
    };
  }


  // ----- background jobs -----
  // Runs fn in the background; the state says busy until it ends. Errors are kept for the client to retry.
  function startJob(session, key, roundData, kind, fn) {
    const p = roundData.personal;
    if (running(p.job)) return false;
    p.job = { kind, startedAt: new Date().toISOString() };
    save(session, key, roundData).then(async () => {
      try {
        await fn();
        p.job = null;
      } catch (e) {
        p.job = { kind, startedAt: p.job?.startedAt, error: e.name === 'TimeoutError' ? 'timeout' : 'failed' };
        logger.forSession(session, Number(key)).write('server.error', { route: `/api/personal (${kind})`, error: p.job.error, detail: e.message });
      }
      await save(session, key, roundData);
    });
    return true;
  }

  // The first pair, from the deliberation. Then each next pair from the brief, the chosen version and
  // the writer's latest words. Both are one lean call (config.personal.calls.step).
  async function runFirst(session, round, key, roundData, task) {
    const p = roundData.personal;
    const b = budget(session, round, task);
    const content = [
      taskText(task),
      `What the writer said while thinking the task through:\n${transcript(p)}`,
      `Pairs available in all: about ${b.pairsLeft}.`,
    ].join('\n\n');
    await writePair(session, round, roundData, task, 'first', content, { action: 'start' }, b);
  }
  async function runStep(session, round, key, roundData, task, latest) {
    const p = roundData.personal;
    const b = budget(session, round, task);
    const last = p.comparisons.at(-1);
    const chosen = last?.cards.find((c) => c.id === latest.cardId);
    const content = [
      taskText(task),
      `Brief so far:\n${(p.brief ?? []).map((x) => `- ${x}`).join('\n') || '(empty)'}`,
      `Approach: ${p.approach ?? 'undecided'}. Settled: ${(p.settled ?? []).join('; ') || 'nothing yet'}. Open, general first: ${(p.open ?? []).join('; ') || 'nothing'}.`,
      `Aspect of the last pair: ${last?.aspect ?? ''}`,
      latest.action === 'neither'
        ? `Neither version fit. Version A:\n${last.cards[0].text}\n\nVersion B:\n${last.cards[1].text}`
        : `The version the writer chose ("${chosen?.lens}"):\n${chosen?.text ?? ''}`,
      `What the writer said: ${latest.note ? `"${latest.note}"` : '(nothing)'}`,
      `Pairs left: about ${b.pairsLeft}.${b.pairsLeft <= 1 ? ' Write the final pair now.' : ''}`,
    ].join('\n\n');
    await writePair(session, round, roundData, task, 'step', content, latest, b);
  }
  async function writePair(session, round, roundData, task, promptName, content, latest, b) {
    const p = roundData.personal;
    // One more try when the answer is unusable (rare with a small model).
    const out = await call('step', promptName, content, STEP_SCHEMA, logger.forSession(session, round))
      .catch(() => call('step', promptName, content, STEP_SCHEMA, logger.forSession(session, round)));
    const d = out.data;
    const cards = (d.cards ?? []).slice(0, 2);
    if (cards.length < 2 || cards.some((c) => !clean(c.text))) throw new Error('The step did not return two versions');
    const n = p.comparisons.length + 1;
    Object.assign(p, { brief: (d.brief ?? []).map(clean).filter(Boolean), approach: clean(d.approach) || p.approach, settled: d.settled ?? [], open: d.open ?? [] });
    if (!p.plan) p.plan = { approach: p.approach, open: p.open, brief: p.brief, createdAt: new Date().toISOString() };
    p.comparisons.push({
      n, aspect: clean(d.aspect), mode: d.mode, final: Boolean(d.final) || b.pairsLeft <= 1,
      cards: cards.map((c, i) => ({ id: `c${n}${i ? 'b' : 'a'}`, lens: clean(c.lens), text: cleanResponse(clean(c.text)) || clean(c.text) })),
      brief: p.brief, open: p.open, createdAt: new Date().toISOString(), budget: b,
    });
    logger.forSession(session, round).write('server.personal.step', { n, prompt: promptName, latest, latencyMs: out.latencyMs, model: out.model, usage: out.usage, budget: b, answer: d });
  }


  // Profile: two passes. Evidence (observations grounded in quotes and measures), then the profile.
  function measures(p) {
    const said = (p.deliberation?.items ?? []).filter((x) => x.kind === 'said');
    const answered = p.comparisons.filter((c) => c.response);
    const decisionSeconds = answered.map((c) => (Date.parse(c.response.at) - Date.parse(c.shownAt ?? c.createdAt)) / 1000).filter((x) => x > 0);
    const notes = answered.map((c) => words(c.response.note));
    return {
      deliberation: {
        condition: p.condition, recordings: said.length, words: said.reduce((s, x) => s + words(x.text), 0),
        seconds: p.deliberation?.finishedAt ? Math.round((Date.parse(p.deliberation.finishedAt) - Date.parse(p.deliberation.startedAt)) / 1000) : null,
        endedBy: p.deliberation?.finishReason ?? null,
      },
      comparisons: {
        shown: p.comparisons.length, answered: answered.length,
        neither: answered.filter((c) => c.response.action === 'neither').length,
        withoutWords: notes.filter((x) => x === 0).length,
        averageWords: notes.length ? Math.round(notes.reduce((a, x) => a + x, 0) / notes.length) : 0,
        medianDecisionSeconds: decisionSeconds.length ? Math.round(decisionSeconds.sort((a, x) => a - x)[Math.floor(decisionSeconds.length / 2)]) : null,
        aspectsSettled: p.settled?.length ?? 0, aspectsOpen: p.open?.length ?? 0,
      },
      accepted: Boolean(p.accepted),
    };
  }
  async function runProfile(session, round, key, roundData) {
    const p = roundData.personal;
    const log = logger.forSession(session, round);
    const m = measures(p);
    const finalText = p.accepted?.text ?? p.comparisons.at(-1)?.cards?.find((c) => c.id === p.comparisons.at(-1)?.response?.cardId)?.text ?? '(no final text)';
    const evidenceIn = [
      `What the writer said while deliberating:\n${transcript(p)}`,
      `What the system took from it (approach, brief, aspects): ${JSON.stringify({ approach: p.plan?.approach, brief: p.brief, settled: p.settled, open: p.plan?.open })}`,
      `Comparisons:\n${history(p)}`,
      `Final text:\n${finalText}`,
      `Behaviour measures:\n${JSON.stringify(m)}`,
    ].join('\n\n');
    const ev = await call('evidence', 'profile-evidence', evidenceIn, EVIDENCE_SCHEMA, log);
    const profileIn = [
      `Writing strategies (catalog):\n${await scaffold.strategies()}`,
      `Observations from this task:\n${JSON.stringify(ev.data.observations)}`,
      `Parameters from earlier tasks:\n${session.profile ? JSON.stringify(session.profile.result) : '(none: this is the first task)'}`,
    ].join('\n\n');
    const pr = await call('profile', 'profile', profileIn, PROFILE_SCHEMA, log);
    p.profile = { evidence: ev.data.observations, result: pr.data, measures: m, createdAt: new Date().toISOString() };
    await store.update(session, (s) => { s.profile = { round, result: pr.data, createdAt: p.profile.createdAt }; });
    log.write('server.personal.profile', {
      evidenceLatencyMs: ev.latencyMs, profileLatencyMs: pr.latencyMs, models: [ev.model, pr.model], usage: [ev.usage, pr.usage],
      measures: m, observations: ev.data.observations, profile: pr.data,
    });
  }

  // ----- deliberation -----
  async function conditionOf(p) {
    const all = await scaffold.conditions();
    return all[p.condition] ? { key: p.condition, ...all[p.condition] } : { key: 'open', ...all.open };
  }
  function nextStatic(cond, p) {
    const asked = (p.deliberation?.items ?? []).filter((x) => x.kind === 'prompt').map((x) => x.text);
    return (cond.prompts ?? []).find((q) => !asked.includes(q)) ?? null;
  }
  const deliberationView = async (p) => {
    const cond = await conditionOf(p);
    return {
      condition: cond.key, label: cond.label, intro: cond.intro, intervalSeconds: cond.intervalSeconds ?? null,
      items: p.deliberation?.items ?? [], startedAt: p.deliberation?.startedAt ?? null, finishedAt: p.deliberation?.finishedAt ?? null,
      seconds: P.deliberation.seconds, minSeconds: P.deliberation.minSeconds,
    };
  };

  r.post('/deliberation/start', requireSession(store), async (req, res) => {
    const x = parse(req, res);
    if (!x) return;
    const { session, round, key, roundData, p } = x;
    if (!p.deliberation) {
      const cond = await conditionOf(p);
      p.deliberation = { startedAt: new Date().toISOString(), finishedAt: null, items: [] };
      const first = cond.first ?? nextStatic(cond, p);
      if (first) p.deliberation.items.push({ kind: 'prompt', text: first, at: p.deliberation.startedAt, focus: 'start' });
      await save(session, key, roundData);
      logger.forSession(session, round).write('server.personal.deliberationStarted', { condition: p.condition, firstQuestion: first ?? null });
    }
    res.json(await deliberationView(p));
  });

  r.post('/deliberation/say', requireSession(store), limit, async (req, res) => {
    const x = parse(req, res);
    if (!x) return;
    const { session, round, key, roundData, p, task } = x;
    const text = clean(req.body?.text);
    if (!text) return res.status(400).json({ error: 'empty' });
    if (text.length > MAX_CHARS) return res.status(413).json({ error: 'too_long' });
    if (!p.deliberation || p.deliberation.finishedAt) return res.status(409).json({ error: 'not_open' });
    const now = new Date().toISOString();
    p.deliberation.items.push({ kind: 'said', text, at: now });
    const cond = await conditionOf(p);
    const log = logger.forSession(session, round);
    log.write('server.personal.said', { text, words: words(text), condition: cond.key });
    let question = null;
    if (cond.key === 'static') question = nextStatic(cond, p);
    if (cond.key === 'adaptive') {
      const elapsed = (Date.now() - Date.parse(p.deliberation.startedAt)) / 1000;
      const content = [taskText(task), `Deliberation so far:\n${transcript(p)}`, `Time left: about ${Math.max(0, Math.round(P.deliberation.seconds - elapsed))} seconds.`].join('\n\n');
      try {
        const out = await call('adaptive', 'deliberation-adaptive', content, ADAPTIVE_SCHEMA, log);
        question = clean(out.data.question);
        log.write('server.personal.adaptivePrompt', { question, focus: out.data.focus, latencyMs: out.latencyMs, model: out.model, usage: out.usage });
        if (question) p.deliberation.items.push({ kind: 'prompt', text: question, focus: clean(out.data.focus), at: new Date().toISOString() });
      } catch (e) {
        log.write('server.error', { route: '/api/personal/deliberation/say', error: 'adaptive_failed', detail: e.message });
      }
    } else if (question) p.deliberation.items.push({ kind: 'prompt', text: question, at: new Date().toISOString() });
    await save(session, key, roundData);
    res.json(await deliberationView(p));
  });

  // A static question on a timer (the static condition shows the next one after a silence).
  r.post('/deliberation/tick', requireSession(store), async (req, res) => {
    const x = parse(req, res);
    if (!x) return;
    const { session, key, roundData, p } = x;
    const cond = await conditionOf(p);
    if (cond.key === 'static' && p.deliberation && !p.deliberation.finishedAt) {
      const q = nextStatic(cond, p);
      if (q) { p.deliberation.items.push({ kind: 'prompt', text: q, at: new Date().toISOString(), focus: 'timer' }); await save(session, key, roundData); }
    }
    res.json(await deliberationView(p));
  });

  r.post('/deliberation/finish', requireSession(store), async (req, res) => {
    const x = parse(req, res);
    if (!x) return;
    const { session, round, key, roundData, p, task } = x;
    if (!p.deliberation) return res.status(409).json({ error: 'not_started' });
    if (!p.deliberation.finishedAt) {
      p.deliberation.finishedAt = new Date().toISOString();
      p.deliberation.finishReason = ['done', 'time', 'dev'].includes(req.body?.reason) ? req.body.reason : 'done';
      logger.forSession(session, round).write('server.personal.deliberationFinished', { reason: p.deliberation.finishReason, items: p.deliberation.items.length });
    }
    if (!p.plan && !p.comparisons.length) startJob(session, key, roundData, 'plan', () => runFirst(session, round, key, roundData, task));
    else await save(session, key, roundData);
    res.json(publicState(p));
  });

  // ----- comparisons -----
  r.post('/state', requireSession(store), async (req, res) => {
    const x = parse(req, res);
    if (!x) return;
    const { session, round, key, roundData, p, task } = x;
    // Retry after a failed job, or pick up planning that never started.
    if (req.body?.retry && p.job?.error) {
      const kind = p.job.kind;
      p.job = null;
      if (kind === 'plan') startJob(session, key, roundData, 'plan', () => runFirst(session, round, key, roundData, task));
      else if (kind === 'step') startJob(session, key, roundData, 'step', () => runStep(session, round, key, roundData, task, p.retryLatest ?? { action: 'start' }));
      else if (kind === 'profile') startJob(session, key, roundData, 'profile', () => runProfile(session, round, key, roundData));
    } else if (p.deliberation?.finishedAt && !p.plan && !running(p.job) && !p.job?.error) {
      startJob(session, key, roundData, 'plan', () => runFirst(session, round, key, roundData, task));
    }
    // The first time a pair is seen counts for the decision time.
    const current = p.comparisons.at(-1);
    if (current && !current.shownAt && req.body?.seen) { current.shownAt = new Date().toISOString(); await save(session, key, roundData); }
    res.json(publicState(p));
  });

  r.post('/act', requireSession(store), limit, async (req, res) => {
    const x = parse(req, res);
    if (!x) return;
    const { session, round, key, roundData, p, task } = x;
    const current = p.comparisons.at(-1);
    if (!current || current.response || p.accepted) return res.status(409).json({ error: 'no_pair' });
    if (running(p.job)) return res.status(409).json({ error: 'busy' });
    const action = req.body?.action;
    if (!['pick', 'neither'].includes(action)) return res.status(400).json({ error: 'bad_action' });
    const note = clean(req.body?.note).slice(0, MAX_CHARS);
    const cardId = action === 'pick' ? req.body?.cardId : null;
    const side = current.cards[0].id === cardId ? 'A' : current.cards[1].id === cardId ? 'B' : null;
    if (action === 'pick' && !side) return res.status(400).json({ error: 'bad_card' });
    current.response = { action, cardId, note, at: new Date().toISOString() };
    const latest = { action, side, cardId, note };
    p.retryLatest = latest;
    logger.forSession(session, round).write('server.personal.response', { n: current.n, action, cardId, side, note, words: words(note) });
    startJob(session, key, roundData, 'step', () => runStep(session, round, key, roundData, task, latest));
    res.json(publicState(p));
  });

  // A failed step: the response is taken back, so the participant can act again.
  r.post('/undo-failed', requireSession(store), async (req, res) => {
    const x = parse(req, res);
    if (!x) return;
    const { session, key, roundData, p } = x;
    if (p.job?.error && p.job.kind === 'step') { p.comparisons.at(-1).response = null; p.job = null; await save(session, key, roundData); }
    res.json(publicState(p));
  });

  r.post('/accept', requireSession(store), async (req, res) => {
    const x = parse(req, res);
    if (!x) return;
    const { session, round, key, roundData, p } = x;
    const current = p.comparisons.at(-1);
    const card = current?.cards.find((c) => c.id === req.body?.cardId);
    if (!card) return res.status(400).json({ error: 'bad_card' });
    if (!current.response) current.response = { action: 'pick', cardId: card.id, note: clean(req.body?.note), at: new Date().toISOString(), accepted: true };
    p.accepted = { cardId: card.id, text: card.text, at: new Date().toISOString() };
    logger.forSession(session, round).write('server.personal.accepted', { n: current.n, cardId: card.id, text: card.text, comparisons: p.comparisons.length });
    if (!p.profile) startJob(session, key, roundData, 'profile', () => runProfile(session, round, key, roundData));
    else await save(session, key, roundData);
    res.json(publicState(p));
  });

  // ----- export -----
  r.get('/export', requireSession(store), (req, res) => {
    if (!P.offerExport && !app.env.devMode) return res.status(404).json({ error: 'not_found' });
    const data = exportSession(req.study);
    const name = `session-${String(req.study.participantId).toLowerCase()}-${req.study.id.slice(0, 8)}.json`;
    logger.forSession(req.study).write('server.personal.exported', { rounds: data.rounds.length });
    res.set('Content-Disposition', `attachment; filename="${name}"`);
    res.json(data);
  });

  // ----- profile -----
  r.post('/profile', requireSession(store), async (req, res) => {
    const x = parse(req, res);
    if (!x) return;
    const { session, round, key, roundData, p } = x;
    if (!p.profile && !running(p.job) && (!p.job?.error || req.body?.retry)) {
      p.job = null;
      startJob(session, key, roundData, 'profile', () => runProfile(session, round, key, roundData));
    }
    res.json({ busy: running(p.job) && p.job.kind === 'profile', error: p.job?.kind === 'profile' ? p.job.error ?? null : null, profile: p.profile?.result ?? null });
  });

  return r;
}

// The session as a file. replay holds per task what the participant said and did, in order, so
// scripts/replay.mjs can run it again; the rest is the full record of what the system made of it.
export function exportSession(session) {
  const letter = (c, id) => (c.cards[0]?.id === id ? 'A' : c.cards[1]?.id === id ? 'B' : null);
  const rounds = Object.entries(session.rounds ?? {}).filter(([, rd]) => rd.personal).map(([k, rd]) => {
    const p = rd.personal;
    const comparisons = p.comparisons.map((c) => ({
      n: c.n, aspect: c.aspect, mode: c.mode, final: c.final, brief: c.brief, open: c.open,
      cards: c.cards.map((x, i) => ({ letter: i ? 'B' : 'A', lens: x.lens, text: x.text })),
      response: c.response ? { action: c.response.action, card: letter(c, c.response.cardId), note: c.response.note ?? '', at: c.response.at } : null,
    }));
    return {
      round: Number(k), taskId: rd.taskId, condition: p.condition, deliberation: p.deliberation, plan: p.plan ?? null,
      brief: p.brief ?? [], approach: p.approach ?? null, settled: p.settled ?? [], open: p.open ?? [], comparisons, accepted: p.accepted ?? null, profile: p.profile ?? null,
    };
  });
  return {
    format: 'hyux-personalize-session/1',
    exportedAt: new Date().toISOString(),
    participantId: session.participantId,
    sessionId: session.id,
    rounds,
    replay: rounds.map((r) => ({
      round: r.round,
      condition: r.condition,
      said: (r.deliberation?.items ?? []).filter((x) => x.kind === 'said').map((x) => x.text),
      responses: r.comparisons.filter((c) => c.response).map((c) => ({ action: c.response.action, card: c.response.card, note: c.response.note })),
      accepted: r.accepted ? (r.comparisons.at(-1)?.cards.find((x) => x.text === r.accepted.text)?.letter ?? null) : null,
    })),
  };
}

// For the dev drawer: everything about the round, including what participants never see.
export function inspectRound(roundData) {
  const p = roundData?.personal;
  if (!p) return null;
  return {
    condition: p.condition, job: p.job ?? null, deliberation: p.deliberation, plan: p.plan ?? null,
    brief: p.brief ?? [], approach: p.approach ?? null, settled: p.settled ?? [], open: p.open ?? [],
    comparisons: p.comparisons.map(({ n, aspect, mode, final, cards, response }) => ({ n, aspect, mode, final, lenses: cards.map((c) => c.lens), response })),
    accepted: p.accepted ?? null, profile: p.profile ?? null,
  };
}
