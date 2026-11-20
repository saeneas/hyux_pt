// Dev drawer. Served from /dev only when DEV_MODE=true; participants never receive this file.
// Researcher-facing, so its labels live here rather than in the participant strings file.
// A small tab at the right edge opens a drawer: start a session as one of the participants with a
// deliberation condition, jump to any step, change the condition, end the thinking time, reset the
// round, set the timer speed, and look inside (plan, path, profile, events).
import { h, clear } from '/js/core/dom.js';
import { onLogEvent } from '/js/core/logEvent.js';

const STORE = 'hyux.dev';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(STORE)) ?? {}; } catch { return {}; } };
const savePrefs = (p) => { try { localStorage.setItem(STORE, JSON.stringify(p)); } catch { /* ignore */ } };

export function initDevPanel(ctx) {
  const { flow, session, api, config, t } = ctx;
  const prefs = { open: false, timerSpeed: 1, tab: 'plan', ...loadPrefs() };
  ctx.dev.timerSpeed = prefs.timerSpeed;
  const names = config.participants?.pickList ?? [];
  let conditions = [];
  let inspect = null;

  const stepLabel = (s) => `${t(`steps.${s.screen}`)}${s.round ? ` · ${s.round}` : ''}`;
  const btn = (label, onclick, cls = '') => h(`button.dd-btn${cls}`, { type: 'button', onclick }, label);
  const select = (label, options, value, onchange) => {
    const el = h('select.dd-select', { 'aria-label': label }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
    el.addEventListener('change', () => onchange(el.value));
    return el;
  };
  const section = (title, ...children) => h('section.dd-section', h('h3.dd-section__title', title), ...children);

  // ----- session -----
  const sessionInfo = h('div.dd-meta');
  const nameSel = select('Participant', names.map((n) => [n, n]), prefs.name ?? names[0], (v) => { prefs.name = v; savePrefs(prefs); });
  const condSel = h('select.dd-select', { 'aria-label': 'Deliberation condition' });
  async function newSession() {
    const data = await api.dev.startSession(nameSel.value || prefs.name, condSel.value || undefined);
    session.set(data);
    const i = flow.indexOf('welcome');
    await flow.goTo(i + 1, { reason: 'dev.newSession' });
    refreshInspect();
  }
  condSel.addEventListener('change', async () => {
    prefs.condition = condSel.value;
    savePrefs(prefs);
    if (!session.active) return;
    try { await api.dev.setCondition(condSel.value); refreshInspect(); } catch (e) { alert(`Could not set the condition: ${e.code ?? e.message}`); }
  });

  // ----- steps -----
  const stepList = h('ol.dd-steps');
  async function jump(index) {
    if (!session.active) await newSession();
    await flow.goTo(index, { reason: 'dev' });
  }
  function renderSteps() {
    clear(stepList).append(...flow.steps.map((s) => h(`li${s.index === flow.index ? '.is-current' : ''}`,
      h('button', { type: 'button', onclick: () => jump(s.index) }, h('span.dd-steps__n', String(s.index + 1)), stepLabel(s)))));
  }

  // ----- round -----
  const round = () => flow.step?.round ?? null;
  async function endThinking() {
    if (ctx.dev.finishStep) return ctx.dev.finishStep();
    alert('The thinking step is not on screen.');
  }
  async function resetRound() {
    const r = round();
    if (!r || !confirm(`Reset task ${r}? Its deliberation, plan and comparisons are deleted.`)) return;
    await api.dev.resetRound(r);
    session.set(await api.getSession());
    await flow.goTo(flow.indexOf('briefing', r), { reason: 'dev.reset' });
    refreshInspect();
  }

  // ----- timer -----
  const speedSel = select('Timer speed', config.dev.timerSpeeds.map((s) => [String(s), `${s}×`]), String(prefs.timerSpeed), (v) => {
    prefs.timerSpeed = Number(v);
    ctx.dev.timerSpeed = prefs.timerSpeed;
    savePrefs(prefs);
    ctx.dev.onTimerSpeed?.(prefs.timerSpeed);
  });

  // ----- inspector -----
  const tabs = ['plan', 'path', 'profile', 'events'];
  const tabBar = h('div.dd-tabs', { role: 'tablist' });
  const view = h('div.dd-view');
  const events = h('ol.dd-events');
  onLogEvent((e) => {
    const payload = Object.keys(e.payload ?? {}).length ? ` ${JSON.stringify(e.payload)}` : '';
    events.prepend(h('li', h('span.dd-meta', `${e.clientTs.slice(11, 19)} `), h('b', e.type), payload));
    while (events.children.length > 80) events.lastChild.remove();
    if (/^(personal|deliberate|profile)\./.test(e.type)) refreshInspect();
  });
  const kv = (k, v) => h('div.dd-kv', h('span.dd-kv__k', k), h('span.dd-kv__v', v ?? '–'));
  const json = (v) => h('pre.dd-pre', JSON.stringify(v, null, 2));
  function renderView() {
    clear(tabBar).append(...tabs.map((tab) => h(`button.dd-tab${prefs.tab === tab ? '.is-on' : ''}`, { type: 'button', role: 'tab', onclick: () => { prefs.tab = tab; savePrefs(prefs); renderView(); } }, tab)));
    const rd = inspect?.rounds?.[String(round() ?? 1)];
    clear(view);
    if (prefs.tab === 'events') return view.append(events);
    if (!rd) return view.append(h('p.dd-meta', 'Nothing for this task yet.'));
    if (prefs.tab === 'plan') {
      const pl = rd.plan;
      view.append(kv('Condition', rd.condition), kv('Job', rd.job ? `${rd.job.kind}${rd.job.error ? ` (failed: ${rd.job.error})` : ' …'}` : 'idle'));
      if (!pl) return view.append(h('p.dd-meta', 'No plan yet.'));
      view.append(
        kv('Strategy', `${pl.strategy?.leading}${pl.strategy?.second ? ` / ${pl.strategy.second}` : ''} · ${Math.round((pl.strategy?.confidence ?? 0) * 100)} %${pl.strategy?.named ? ' · named by the participant' : ''}`),
        h('ul.dd-list', (pl.strategy?.evidence ?? []).map((e) => h('li', e))),
        h('h4.dd-h', 'Preferences'), h('ul.dd-list', (pl.preferences ?? []).map((p) => h('li', `${p.statement} — “${p.quote}”`))),
        h('h4.dd-h', 'Decisions'), h('ul.dd-list', (pl.decisions ?? []).map((d) => h(`li.dd-dec.is-${d.status}`, `${d.decision}: ${d.status}${d.contingency ? ' · contingency' : ''}${d.value ? ` → ${d.value}` : ''}`))),
        h('h4.dd-h', 'Reasoning'), h('p.dd-text', pl.reasoning ?? ''),
        h('h4.dd-h', 'Message to the participant'), h('p.dd-text', pl.message ?? ''));
    } else if (prefs.tab === 'path') {
      view.append(h('h4.dd-h', 'Stages'), h('ul.dd-list', (rd.stages ?? []).map((s) => h(`li.dd-stage.is-${s.status}`, `${s.title} · ${s.status}${Number.isFinite(s.clarity) ? ` · clarity ${Math.round(s.clarity * 100)} %` : ''} — ${s.goal}`))));
      view.append(h('h4.dd-h', 'Comparisons'), h('ol.dd-list', (rd.comparisons ?? []).map((c) => h('li',
        h('b', `${c.mode}${c.action === 'final' ? ' · final' : ''} · understanding ${Math.round((c.understanding ?? 0) * 100)} %`), h('br'),
        `A: ${c.lenses[0]} | B: ${c.lenses[1]}`, h('br'),
        h('span.dd-meta', c.reasoning ?? ''),
        c.response ? h('div.dd-resp', `→ ${c.response.action}${c.response.cardId ? ` ${c.response.cardId.slice(-1).toUpperCase()}` : ''}${c.response.note ? `: “${c.response.note}”` : ''}`) : null))));
      if (rd.known) view.append(h('h4.dd-h', 'What the system knows'), json(rd.known));
    } else if (prefs.tab === 'profile') {
      const pr = rd.profile;
      if (!pr) return view.append(h('p.dd-meta', 'No profile yet (it starts when a final text is chosen, at the latest with the questionnaire).'));
      view.append(h('h4.dd-h', 'Measures'), json(pr.measures), h('h4.dd-h', 'Profile'), json(pr.result), h('h4.dd-h', `Observations (${pr.evidence?.length ?? 0})`), json(pr.evidence));
    }
  }
  async function refreshInspect() {
    if (!session.active) { inspect = null; renderView(); return; }
    try { inspect = await api.dev.inspect(); } catch { /* keep the last */ }
    renderView();
  }
  setInterval(() => { if (prefs.open && ['plan', 'path'].includes(prefs.tab) && inspect?.rounds?.[String(round())]?.job) refreshInspect(); }, 2500);

  // ----- layout -----
  const tab = h('button.dd-tab-handle', { type: 'button', 'aria-label': 'Open dev drawer' }, 'Dev');
  const drawer = h('aside.dd', { 'aria-label': 'Dev drawer' },
    h('header.dd-head', h('span.dd-title', 'Prototype controls'), btn('Close', () => setOpen(false), '.dd-btn--ghost')),
    h('div.dd-scroll',
      section('Session', sessionInfo, h('div.dd-row', nameSel, condSel), h('div.dd-row', btn('Start new session', newSession, '.dd-btn--primary'))),
      section('Go to step', stepList),
      section('This task', h('div.dd-row', btn('End thinking now', endThinking), btn('Reset task', resetRound, '.dd-btn--ghost')),
        h('div.dd-row', h('span.dd-meta', 'Timer speed'), speedSel)),
      section('Inspector', h('div.dd-row', tabBar, btn('Refresh', refreshInspect, '.dd-btn--ghost')), view)));
  function setOpen(open) {
    prefs.open = open;
    savePrefs(prefs);
    drawer.classList.toggle('is-open', open);
    tab.setAttribute('aria-expanded', String(open));
    if (open) refreshInspect();
  }
  tab.addEventListener('click', () => setOpen(!prefs.open));

  function render() {
    const d = session.data;
    clear(sessionInfo).append(d ? `${d.participantId} · ${d.id.slice(0, 8)} · condition ${inspect?.condition ?? d.dev?.condition ?? '?'}` : 'No session yet');
    renderSteps();
    renderView();
  }
  session.onChange(() => { render(); refreshInspect(); });
  flow.onChange(() => { render(); refreshInspect(); });

  api.dev.conditions().then((res) => {
    conditions = res.conditions;
    clear(condSel).append(...conditions.map((c) => h('option', { value: c.key }, c.label)));
    condSel.value = session.data?.dev?.condition ?? prefs.condition ?? res.default;
  }).catch(() => {});

  render();
  document.body.append(tab, drawer);
  setOpen(prefs.open);
}
