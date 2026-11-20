// Personal mode canvas (personalize): guided comparisons planned from the deliberation.
//
//   Layout: the task sidebar on the left; in the middle the path (the plan's stages, the current one
//   marked, with how clear each is), the question of the current comparison and two cards; below them
//   the reason (spoken) and the actions; the timer at the bottom.
//   Each comparison: the participant chooses a card (or Neither Fits) and says why; Continue sends it
//   and the server writes the next pair (server/routes/personal.js, scaffold/prompts/step.md). Move On
//   leaves the current stage, Write Final Versions asks for two full versions now, Use This Email takes a
//   full version as the result. While the server works, the state is polled.
//
// Same interface as the other canvases (createCanvas(ctx, options) → { el, timerSlot, noticeSlot, regions,
// getRegion, onFinishRequest, isBusy, whenIdle, setLocked, stopRecording, destroy }).
import { h, icon, clear, messageStrip } from '../../core/dom.js';
import { t, raw } from '../../core/strings.js';
import { api } from '../../core/api.js';
import { logEvent } from '../../core/logEvent.js';
import { createTaskSidebar } from '../../core/canvas/taskSidebar.js';
import { createVoiceInput } from '../../core/canvas/voiceInput.js';
import { renderMarked } from './marks.js';

const MODE = {
  confirm: { key: 'personal.modeConfirm', icon: 'accept' },
  probe: { key: 'personal.modeProbe', icon: 'compare' },
  alert: { key: 'personal.modeAlert', icon: 'warning' },
};

export function createCanvas(ctx, { round, task, live = true, conceal = false, showFinish = true }) {
  const { config } = ctx;
  const ptt = config.interaction.recordingMode === 'pushToTalk';

  // ----- state -----
  let state = null; // the server's public state
  let choice = null; // card id or 'neither'
  let note = '';
  let recordingSeconds = null;
  let transcribing = false;
  let sending = false; // an action is on its way
  let error = null; // { key, retry, undo }
  let locked = !live;
  let destroyed = false;
  let pollTimer = null;
  let busyTimer = null;
  let busyIndex = 0;
  let shownN = null; // the comparison on screen
  // Resolves when the first pair is on screen: the task time starts then (screens/task.js).
  let markReady;
  const ready = new Promise((resolve) => { markReady = resolve; });
  let seenSent = null;

  const work = new Set();
  const waiters = [];
  const setBusy = (key, on) => {
    if (on) work.add(key); else work.delete(key);
    if (!work.size) waiters.splice(0).forEach((fn) => fn());
  };
  const voiceBusy = () => recordingSeconds !== null || transcribing;
  const comparison = () => state?.comparison ?? null;
  const serverBusy = () => Boolean(state?.busy) || sending;

  // ----- layout -----
  const sidebar = createTaskSidebar({ task, round, live, conceal });
  const noticeSlot = h('div.vc-notices');
  const path = h('ol.ps-path', { 'aria-label': t('personal.pathLabel') });
  const meterFill = h('span.ps-meter__fill');
  const meter = h('div.ps-meter', { title: t('personal.understanding') }, h('span.ps-meter__label', t('personal.understanding')), h('span.ps-meter__track', meterFill));
  const message = h('p.ps-message', { 'aria-live': 'polite' });
  const modeTag = h('span.ps-mode');
  const question = h('h2.ps-question');
  // What the two highlight colours mean.
  const legend = h('div.ps-legend',
    h('span.ps-legend__item', h('mark.ps-mark.ps-mark--now', '  '), h('span', t('personal.legendNow'))),
    h('span.ps-legend__item.ps-legend__item--before', h('mark.ps-mark.ps-mark--before', '  '), h('span', t('personal.legendBefore'))));
  const pairEl = h('div.ps-pair', { dataset: { region: 'output' } });
  const busyEl = h('div.ps-busy', { 'aria-live': 'polite' });

  // The reason: one microphone for the current choice.
  const micBtn = h('button.app-record.ps-mic', { type: 'button' }, icon('microphone'));
  const noteLabel = h('span.ps-note__label');
  const noteText = h('p.ps-note__text');
  const noteClear = h('button.fh-btn.fh-btn--transparent.fh-btn--icon', { type: 'button', title: t('personal.clearNote'), 'aria-label': t('personal.clearNote') }, icon('decline'));
  noteClear.addEventListener('click', () => { logEvent('personal.noteCleared', { chars: note.length }); note = ''; render(); });
  const noteEl = h('div.ps-note', micBtn, h('div.ps-note__main', noteLabel, noteText), noteClear);

  const btn = (cls, key, iconName) => h(`button.fh-btn${cls}`, { type: 'button' }, iconName ? icon(iconName) : null, h('span', t(key)));
  const neitherBtn = btn('.fh-btn--transparent.ps-neither', 'personal.neither', 'sys-cancel');
  const skipBtn = btn('.fh-btn--transparent', 'personal.skip', 'forward');
  const finalBtn = btn('.fh-btn--transparent', 'personal.final', 'document-text');
  const nextBtn = btn('.fh-btn--emphasized.ps-next', 'personal.next', 'navigation-right-arrow');
  const acceptBtn = btn('.ps-accept', 'personal.accept', 'accept');
  const actions = h('div.ps-actions', h('div.ps-actions__side', neitherBtn, skipBtn, finalBtn), h('div.ps-actions__main', acceptBtn, nextBtn));
  const finishBtn = h('button.fh-btn', { type: 'button', hidden: !showFinish, dataset: { region: 'finish' } }, t('canvas.finish'));
  const timerSlot = h('div.vc-timer', { dataset: { region: 'timer' } });
  const controls = h('footer.vc-controls.ps-controls', h('div.ps-controls__row', timerSlot, finishBtn));
  const canvasApi = { onFinishRequest: null };
  finishBtn.addEventListener('click', () => canvasApi.onFinishRequest?.());

  const main = h('section.ps-main',
    noticeSlot,
    h('div.ps-top', path, meter),
    message,
    h('div.ps-ask', modeTag, question, legend),
    busyEl,
    pairEl,
    noteEl,
    actions);

  // ----- voice -----
  let input = null;
  if (live) {
    input = createVoiceInput(ctx, {
      round,
      button: micBtn,
      log: () => ({ target: 'personal', choice, n: comparison()?.n }),
      busy: (key, on) => setBusy(`voice:${key}`, on),
      onStart() { recordingSeconds = 0; render(); },
      onTick(s) { recordingSeconds = Math.floor(s); noteLabel.textContent = t('canvas.recordingStatus', { seconds: recordingSeconds }); },
      onStop() { recordingSeconds = null; render(); },
      onTranscribing(on) { transcribing = on; render(); },
      onText(text) { addNote(text); },
      onFail() { recordingSeconds = null; render(); },
    });
  }
  function addNote(text) {
    note = note ? `${note} ${text}` : text;
    logEvent('personal.noted', { n: comparison()?.n, choice, chars: text.length });
    render();
  }

  // ----- server -----
  async function refresh({ retry = false } = {}) {
    clearTimeout(pollTimer);
    if (destroyed || !live) return;
    try {
      const seen = Boolean(state?.comparison && seenSent !== state.comparison.n);
      state = await api.personal.state(round, { seen, retry });
      if (seen) seenSent = state.comparison?.n ?? null;
    } catch {
      // A network problem: try again shortly.
    }
    if (destroyed) return;
    if (state?.comparison) markReady();
    if (state?.comparison && state.comparison.n !== shownN) {
      shownN = state.comparison.n;
      choice = null;
      note = '';
      logEvent('personal.pairShown', { n: shownN, mode: state.comparison.mode, final: state.comparison.final, stages: state.stages.length, understanding: state.understanding });
    }
    render();
    if (state?.busy || state?.phase === 'planning' && !state?.error) pollTimer = setTimeout(refresh, 1500);
    else if (state?.comparison && seenSent !== state.comparison.n) pollTimer = setTimeout(refresh, 300);
  }

  async function act(action) {
    const c = comparison();
    if (!c || locked || serverBusy() || voiceBusy()) return;
    if (action === 'pick' && (!choice || choice === 'neither')) return;
    const body = { action: action === 'pick' && choice === 'neither' ? 'neither' : action, cardId: action === 'pick' && choice !== 'neither' ? choice : undefined, note };
    sending = true;
    error = null;
    setBusy('act', true);
    render();
    logEvent('personal.act', { n: c.n, action: body.action, cardId: body.cardId ?? null, noteWords: note ? note.split(/\s+/).length : 0 });
    try {
      state = await api.personal.act(round, body);
    } catch (e) {
      logEvent('personal.actFailed', { error: e.code ?? e.name });
      error = { key: 'personal.stepFailed', retry: () => act(action) };
    } finally {
      sending = false;
      setBusy('act', false);
    }
    refresh();
  }
  nextBtn.addEventListener('click', () => act('pick'));
  skipBtn.addEventListener('click', () => act('skip'));
  finalBtn.addEventListener('click', () => act('final'));
  neitherBtn.addEventListener('click', () => {
    if (locked || serverBusy()) return;
    choice = choice === 'neither' ? null : 'neither';
    logEvent('personal.chose', { n: comparison()?.n, choice });
    render();
  });

  async function accept() {
    const c = comparison();
    const card = c?.cards.find((x) => x.id === choice);
    if (!card || card.kind !== 'full' || locked || serverBusy()) return;
    sending = true;
    render();
    try {
      state = await api.personal.accept(round, card.id, note);
      logEvent('personal.accepted', { n: c.n, cardId: card.id });
    } catch (e) {
      error = { key: 'personal.acceptFailed', retry: accept };
    } finally {
      sending = false;
    }
    render();
    if (state?.accepted) canvasApi.onFinishRequest?.();
  }
  acceptBtn.addEventListener('click', accept);

  // ----- render -----
  function renderPath() {
    const stages = state?.stages ?? [];
    clear(path).append(...stages.map((s, i) => h(`li.ps-stage.is-${s.status}`, { title: s.title },
      h('span.ps-stage__dot', s.status === 'done' ? icon('accept') : String(i + 1)),
      h('span.ps-stage__title', s.title),
      s.status === 'current' && Number.isFinite(s.clarity) ? h('span.ps-stage__clarity', { style: `--p:${Math.round(s.clarity * 100)}` }) : null)));
    const u = state?.understanding;
    meter.hidden = !Number.isFinite(u);
    meterFill.style.width = `${Math.round((u ?? 0) * 100)}%`;
  }

  function renderBusy() {
    const working = state?.busy || sending || (live && (!state || state.phase === 'planning') && !state?.error);
    busyEl.hidden = !working;
    if (!working) { clearInterval(busyTimer); busyTimer = null; return; }
    const lines = raw(state?.comparison || state?.busy === 'step' ? 'personal.stepping' : 'personal.planning') ?? [];
    if (!busyTimer) {
      busyIndex = 0;
      busyTimer = setInterval(() => { busyIndex = Math.min(busyIndex + 1, lines.length - 1); renderBusy(); }, 3500);
    }
    clear(busyEl).append(h('div.ps-busy__row', h('span.fh-busy', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', lines[busyIndex] ?? '')));
  }

  function renderPair() {
    const c = comparison();
    const working = serverBusy() || !c;
    pairEl.classList.toggle('is-working', working);
    if (working) {
      // Placeholder cards while the next pair is written.
      if (!pairEl.querySelector('.ps-card--ghost')) clear(pairEl).append(...[0, 1].map(() => h('article.ps-card.ps-card--ghost', h('span.ps-ghost.ps-ghost--short'), h('span.ps-ghost'), h('span.ps-ghost'), h('span.ps-ghost.ps-ghost--mid'))));
      pairEl.dataset.n = '';
      return;
    }
    const isNew = pairEl.dataset.n !== String(c.n);
    if (isNew) {
      clear(pairEl);
      const marked = c.cards.map((card, i) => renderMarked(card, c.cards[1 - i]));
      legend.hidden = !marked.some((m) => m.hasNow || m.hasBefore);
      legend.querySelector('.ps-legend__item--before').hidden = !marked.some((m) => m.hasBefore);
      c.cards.forEach((card, i) => {
        const pickBtn = h('button.fh-btn.ps-pick', { type: 'button' }, icon('favorite'), h('span.ps-pick__label'));
        pickBtn.addEventListener('click', () => {
          if (locked || serverBusy()) return;
          choice = card.id;
          logEvent('personal.chose', { n: c.n, choice, lens: card.lens });
          render();
        });
        const el = h('article.ps-card', { dataset: { id: card.id, kind: card.kind }, style: `--delay:${i * 90}ms` },
          h('header.ps-card__head',
            h('span.ps-card__letter', String.fromCharCode(65 + i)),
            h('div.ps-card__titles', h('h3.ps-card__lens', card.lens), h('p.ps-card__why', card.why)),
            h('span.ps-card__kind', t(card.kind === 'full' ? 'personal.full' : 'personal.excerpt'))),
          h('div.ps-card__body', { tabindex: '0' }, h('p.ps-card__text', marked[i].nodes)),
          h('footer.ps-card__foot', pickBtn));
        el.addEventListener('dblclick', () => pickBtn.click());
        pairEl.append(el);
      });
      // A long version opens at the passage the choice is about.
      requestAnimationFrame(() => {
        for (const body of pairEl.querySelectorAll('.ps-card__body')) {
          const mark = body.querySelector('.ps-mark--now');
          if (mark && mark.offsetTop > body.clientHeight * 0.6) body.scrollTop = Math.max(0, mark.offsetTop - body.clientHeight / 3);
        }
      });
      pairEl.dataset.n = String(c.n);
    }
    for (const el of pairEl.querySelectorAll('.ps-card')) {
      const id = el.dataset.id;
      const on = choice === id;
      el.classList.toggle('is-picked', on);
      el.classList.toggle('is-other', Boolean(choice) && !on);
      el.classList.toggle('is-accepted', state.accepted === id);
      const b = el.querySelector('.ps-pick');
      b.disabled = locked || Boolean(state.accepted);
      b.querySelector('.ps-pick__label').textContent = t(on ? 'personal.picked' : 'personal.pick');
      b.classList.toggle('fh-btn--emphasized', on);
    }
  }

  function render() {
    if (destroyed) return;
    const c = comparison();
    const ready = Boolean(c) && !serverBusy();
    const accepted = Boolean(state?.accepted);
    renderPath();
    renderBusy();
    renderPair();
    const msg = accepted ? t('personal.accepted') : c?.final ? t('personal.finalHint') : (c?.message || state?.message || '');
    message.textContent = msg;
    message.hidden = !msg || !live;
    const mode = MODE[c?.mode];
    clear(modeTag);
    if (mode && ready && !accepted) modeTag.append(icon(mode.icon), h('span', t(mode.key)));
    modeTag.dataset.mode = c?.mode ?? '';
    modeTag.hidden = !mode || !ready || accepted;
    question.textContent = ready && !accepted ? c.question : '';
    question.hidden = !ready || accepted || !c.question;
    if (!ready || accepted) legend.hidden = true;

    // The reason.
    const recording = recordingSeconds !== null;
    noteEl.hidden = !ready || accepted;
    noteEl.classList.toggle('is-active', Boolean(choice));
    noteLabel.textContent = recording ? t('canvas.recordingStatus', { seconds: recordingSeconds }) : transcribing ? t('canvas.transcribing') : t(ptt ? 'personal.noteHold' : 'personal.noteStart');
    noteText.textContent = note || (choice === 'neither' ? t('personal.noteNeither') : t('personal.noteHint'));
    noteText.classList.toggle('is-empty', !note);
    noteClear.hidden = !note || voiceBusy();
    micBtn.setAttribute('aria-label', t(ptt ? 'personal.noteHold' : 'personal.noteStart'));
    if (input) {
      if (input.recording) micBtn.disabled = false;
      else input.setEnabled(ready && !locked && !transcribing && !accepted);
    } else micBtn.disabled = true;

    // Actions.
    actions.hidden = !ready || accepted;
    const chosenCard = c?.cards?.find((x) => x.id === choice);
    neitherBtn.classList.toggle('is-on', choice === 'neither');
    neitherBtn.setAttribute('aria-pressed', String(choice === 'neither'));
    nextBtn.disabled = locked || !choice || voiceBusy();
    nextBtn.title = choice ? '' : t('personal.needPick');
    skipBtn.hidden = Boolean(c?.final);
    finalBtn.hidden = Boolean(c?.final) || (state?.count ?? 0) < 2;
    for (const b of [neitherBtn, skipBtn, finalBtn]) b.disabled = locked || voiceBusy();
    acceptBtn.hidden = !chosenCard || chosenCard.kind !== 'full';
    acceptBtn.disabled = locked || voiceBusy();
    finishBtn.disabled = locked;

    clear(noticeSlot);
    const failed = state?.error ? { key: state.busy === null && state.comparison ? 'personal.stepFailed' : 'personal.planFailed', retry: () => refresh({ retry: true }) } : error;
    if (failed) {
      noticeSlot.append(h('div.ic-error', messageStrip('error', t(failed.key)),
        h('div.app-actions', h('button.fh-btn', { type: 'button', onclick: () => { error = null; failed.retry(); } }, t('common.retry')))));
    }
  }

  // ----- assemble -----
  const el = h('div.ps', { class: live ? '' : 'vc--static' }, sidebar.el, main, controls);
  render();
  if (live) refresh();

  return Object.assign(canvasApi, {
    el,
    ready,
    timerSlot,
    noticeSlot,
    regions: { task: sidebar.el, output: pairEl, send: nextBtn, timer: timerSlot, finish: finishBtn },
    getRegion(name) { return this.regions[name]; },
    isBusy: () => work.size > 0,
    whenIdle: () => (work.size ? new Promise((resolve) => waiters.push(resolve)) : Promise.resolve()),
    setLocked(on) { locked = on; render(); },
    stopRecording(reason) { input?.stop(reason); },
    destroy() {
      destroyed = true;
      markReady();
      clearTimeout(pollTimer);
      clearInterval(busyTimer);
      input?.destroy();
      sidebar.destroy();
      waiters.splice(0).forEach((fn) => fn());
    },
  });
}
