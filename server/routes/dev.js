// /api/dev: only mounted when DEV_MODE=true. Every route here 404s in a participant deployment.
import { Router } from 'express';
import { assignTasks } from '../services/taskAssignment.js';
import { requireSession } from '../middleware/session.js';
import { sessionView } from './session.js';
import { inspectRound } from './personal.js';
import * as scaffold from '../services/scaffold.js';

export function devRoutes(app) {
  const { config, store, logger } = app;
  const r = Router();

  // A fresh dev session, for a participant from the list (body.participantId) or the dev ID.
  r.post('/session', async (req, res) => {
    const asked = String(req.body?.participantId ?? '').trim();
    const pid = asked && config.participants.validIds.some((x) => x.toLowerCase() === asked.toLowerCase()) ? asked.toUpperCase() : config.dev.participantId;
    const session = await store.create({
      participantId: pid,
      isDev: true,
      plan: assignTasks(pid, config),
      mode: config.interaction.mode,
      dev: { mock: { stt: config.dev.mockByDefault, llm: config.dev.mockByDefault }, condition: req.body?.condition || config.personal.deliberation.condition },
    });
    logger.write({ participantId: session.participantId, sessionId: session.id, type: 'session.started', payload: { dev: true, plan: session.plan, mode: session.mode } });
    res.status(201).json(sessionView(session, app));
  });

  r.put('/mock', requireSession(store), async (req, res) => {
    const { stt, llm } = req.body ?? {};
    await store.update(req.study, (s) => {
      s.dev = { ...(s.dev ?? {}), mock: { stt: Boolean(stt), llm: Boolean(llm) } };
    });
    res.json({ mock: req.study.dev.mock });
  });

  // Interaction mode of the current session (default: interaction.mode in config.js).
  r.put('/mode', requireSession(store), async (req, res) => {
    const mode = req.body?.mode;
    if (!app.modes.includes(mode)) return res.status(400).json({ error: 'bad_mode' });
    const from = req.study.mode ?? config.interaction.mode;
    await store.update(req.study, (s) => { s.mode = mode; });
    logger.forSession(req.study).write('session.modeChanged', { from, to: mode, via: 'dev' });
    res.json({ mode });
  });

  // personalize: the deliberation conditions, the session's condition, and everything about a round.
  r.get('/conditions', async (req, res) => {
    const all = await scaffold.conditions();
    res.json({ conditions: Object.entries(all).map(([key, c]) => ({ key, label: c.label })), default: config.personal.deliberation.condition });
  });
  r.put('/condition', requireSession(store), async (req, res) => {
    const all = await scaffold.conditions();
    const condition = req.body?.condition;
    if (!all[condition]) return res.status(400).json({ error: 'bad_condition' });
    await store.update(req.study, (s) => {
      s.dev = { ...(s.dev ?? {}), condition };
      // Rounds whose deliberation has not started yet take the new condition.
      for (const rd of Object.values(s.rounds ?? {})) if (rd.personal && !rd.personal.deliberation) rd.personal.condition = condition;
    });
    logger.forSession(req.study).write('dev.conditionChanged', { condition });
    res.json({ condition });
  });
  r.get('/inspect', requireSession(store), (req, res) => {
    const rounds = Object.fromEntries(Object.entries(req.study.rounds ?? {}).map(([k, rd]) => [k, inspectRound(rd)]));
    res.json({ participantId: req.study.participantId, condition: req.study.dev?.condition ?? config.personal.deliberation.condition, profile: req.study.profile ?? null, rounds });
  });
  // Resets one round's personalize state, so a step can be tried again from the deliberation on.
  r.post('/reset-round', requireSession(store), async (req, res) => {
    const round = String(req.body?.round ?? '');
    await store.update(req.study, (s) => {
      if (s.rounds?.[round]) delete s.rounds[round].personal;
      const prog = s.state?.progress?.[round];
      if (prog) { delete prog.taskStartedAt; delete prog.deliberationStartedAt; delete prog.finishedAt; delete prog.timerEvents; }
    });
    res.json({ ok: true });
  });

  return r;
}
