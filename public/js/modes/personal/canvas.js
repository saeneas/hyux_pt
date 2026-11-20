// Personal mode canvas (personalize): two versions at a time, written from the participant's
// deliberation, their choices and their words.
//
//   Layout: the task sidebar on the left; in the middle a headline of a few words (what this pair is
//   about, e.g. "Tone"), two whole versions side by side with highlights (bright blue: where they
//   differ; greyer blue: what changed since the version chosen last), the spoken reason and the actions;
//   the timer at the bottom. Nothing else: the path behind it (brief, aspects) is in the dev drawer.
//   Choose a version (or Neither Fits), hold the microphone and say why, Continue. Use This Email takes
//   the chosen version as the result. While the next pair is written, the current one stays, dimmed.
//
// Same interface as the other canvases (createCanvas(ctx, options) → { el, ready, timerSlot, noticeSlot,
// regions, getRegion, onFinishRequest, isBusy, whenIdle, setLocked, stopRecording, destroy }).
import { h, icon, clear, messageStrip } from '../../core/dom.js';
import { t } from '../../core/strings.js';
import { api } from '../../core/api.js';
import { logEvent } from '../../core/logEvent.js';
import { createTaskSidebar } from '../../core/canvas/taskSidebar.js';
import { createVoiceInput } from '../../core/canvas/voiceInput.js';
import { renderMarked } from './marks.js';

export function createCanvas(ctx, { round, task, live = true, conceal = false, showFinish = true }) {
  const { config } = ctx;
  const ptt = config.interaction.recordingMode === 'pushToTalk';

  // ----- state -----
  let state = null; // the server's public state
  let choice = null; // card id or 'neither'
  let note = '';
  let recordingSeconds = null;
  let transcribing = false;
  let sending = false;
  let error = null;
  let locked = !live;
  let destroyed = false;
  let pollTimer = null;
  let shownN = null;
  let seenSent = null;
  let markReady;
  const ready = new Promise((resolve) => { markReady = resolve; });

  const work = new Set();
  const waiters = [];
  const setBusy = (key, on) => {
    if (on) work.add(key); else work.delete(key);
    if (!work.size) waiters.splice(0).forEach((fn) => fn());
  };
  const voiceBusy = () => recordingSeconds !== null || transcribing;
  const comparison = () => state?.comparison ?? null;
  const writing = () => Boolean(state?.busy) || sending || (live && !state?.comparison && !state?.error);

  // ----- layout -----
  const sidebar = createTaskSidebar({ task, round, live, conceal });
  const noticeSlot = h('div.vc-notices');
  const headline = h('h2.ps-headline');
  const status = h('div.ps-status', { 'aria-live': 'polite' }, h('span.ps-status__line'), h('span.ps-status__text', t('personal.writing')));
  const pairEl = h('div.ps-pair', { dataset: { region: 'output' } });

  const micBtn = h('button.app-record.ps-mic', { type: 'button' }, icon('microphone'));
  const noteLabel = h('span.ps-note__label');
  const noteText = h('p.ps-note__text');
  const levelFill = h('span');
  const level = h('span.ps-note__level', { 'aria-hidden': 'true' }, levelFill);
  const noteClear = h('button.fh-btn.fh-btn--transparent.fh-btn--icon', { type: 'button', title: t('personal.clearNote'), 'aria-label': t('personal.clearNote') }, icon('decline'));
  noteClear.addEventListener('click', () => { logEvent('personal.noteCleared', { chars: note.length }); note = ''; render(); });
  const noteEl = h('div.ps-note', micBtn, h('div.ps-note__main', h('div.ps-note__row', h('span.ps-note__dot', { 'aria-hidden': 'true' }), noteLabel, level), noteText), noteClear);

  const neitherBtn = h('button.fh-btn.fh-btn--transparent.ps-neither', { type: 'button' }, h('span', t('personal.neither')));
  const acceptBtn = h('button.fh-btn.ps-accept', { type: 'button' }, icon('accept'), h('span', t('personal.accept')));
  const nextBtn = h('button.fh-btn.fh-btn--emphasized.ps-next', { type: 'button' }, h('span', t('personal.next')), icon('navigation-right-arrow'));
  const actions = h('div.ps-actions', h('div.ps-actions__side', neitherBtn), h('div.ps-actions__main', acceptBtn, nextBtn));
  const finishBtn = h('button.fh-btn', { type: 'button', hidden: !showFinish, dataset: { region: 'finish' } }, t('canvas.finish'));
  const timerSlot = h('div.vc-timer', { dataset: { region: 'timer' } });
  const controls = h('footer.vc-controls.ps-controls', h('div.ps-controls__row', timerSlot, finishBtn));
  const canvasApi = { onFinishRequest: null };
  finishBtn.addEventListener('click', () => canvasApi.onFinishRequest?.());
  const main = h('section.ps-main', noticeSlot, h('div.ps-head', headline, status), pairEl, noteEl, actions);

  // ----- voice -----
  let input = null;
  if (live) {
    input = createVoiceInput(ctx, {
      round,
      button: micBtn,
      log: () => ({ target: 'personal', choice, n: comparison()?.n }),
      busy: (key, on) => setBusy(`voice:${key}`, on),
      onStart() { recordingSeconds = 0; render(); },
      onTick(s) { recordingSeconds = Math.floor(s); noteLabel.textContent = t('personal.listening', { seconds: recordingSeconds }); },
      onLevel(l) { levelFill.style.width = `${Math.round(l * 100)}%`; },
      onStop() { recordingSeconds = null; levelFill.style.width = '0%'; render(); },
      onTranscribing(on) { transcribing = on; render(); },
      onText(text) {
        note = note ? `${note} ${text}` : text;
        logEvent('personal.noted', { n: comparison()?.n, choice, chars: text.length });
        render();
      },
      onFail() { recordingSeconds = null; render(); },
    });
  }

  // ----- server -----
  async function refresh({ retry = false } = {}) {
    clearTimeout(pollTimer);
    if (destroyed || !live) return;
    try {
      const seen = Boolean(state?.comparison && seenSent !== state.comparison.n);
      state = await api.personal.state(round, { seen, retry });
      if (seen) seenSent = state.comparison?.n ?? null;
    } catch { /* a network problem: try again shortly */ }
    if (destroyed) return;
    if (state?.comparison) markReady();
    if (state?.comparison && state.comparison.n !== shownN && !state.busy) {
      shownN = state.comparison.n;
      choice = null;
      note = '';
      logEvent('personal.pairShown', { n: shownN, aspect: state.comparison.aspect, final: state.comparison.final });
    }
    render();
    if (state?.busy || (!state?.comparison && !state?.error)) pollTimer = setTimeout(refresh, 700);
    else if (state?.comparison && seenSent !== state.comparison.n) pollTimer = setTimeout(refresh, 200);
  }

  async function act() {
    const c = comparison();
    if (!c || !choice || locked || writing() || voiceBusy()) return;
    const body = choice === 'neither' ? { action: 'neither', note } : { action: 'pick', cardId: choice, note };
    sending = true;
    error = null;
    setBusy('act', true);
    render();
    logEvent('personal.act', { n: c.n, action: body.action, cardId: body.cardId ?? null, noteWords: note ? note.split(/\s+/).length : 0 });
    try {
      state = await api.personal.act(round, body);
    } catch (e) {
      logEvent('personal.actFailed', { error: e.code ?? e.name });
      error = { key: 'personal.stepFailed', retry: act };
    } finally {
      sending = false;
      setBusy('act', false);
    }
    refresh();
  }
  nextBtn.addEventListener('click', act);
  neitherBtn.addEventListener('click', () => {
    if (locked || writing()) return;
    choice = choice === 'neither' ? null : 'neither';
    logEvent('personal.chose', { n: comparison()?.n, choice });
    render();
  });

  async function accept() {
    const c = comparison();
    const card = c?.cards.find((x) => x.id === choice);
    if (!card || locked || writing() || voiceBusy()) return;
    sending = true;
    render();
    try {
      state = await api.personal.accept(round, card.id, note);
      logEvent('personal.accepted', { n: c.n, cardId: card.id });
    } catch {
      error = { key: 'personal.acceptFailed', retry: accept };
    } finally {
      sending = false;
    }
    render();
    if (state?.accepted) canvasApi.onFinishRequest?.();
  }
  acceptBtn.addEventListener('click', accept);

  // ----- render -----
  function renderPair() {
    const c = comparison();
    if (!c) {
      if (!pairEl.querySelector('.ps-card--ghost')) clear(pairEl).append(...[0, 1].map(() => h('article.ps-card.ps-card--ghost', h('span.ps-ghost.ps-ghost--short'), h('span.ps-ghost'), h('span.ps-ghost'), h('span.ps-ghost.ps-ghost--mid'))));
      return;
    }
    // The pair on screen changes only once the next one is there; meanwhile it stays, dimmed.
    if (pairEl.dataset.n !== String(c.n) && !state.busy) {
      clear(pairEl);
      c.cards.forEach((card, i) => {
        const other = c.cards[1 - i];
        const el = h('article.ps-card', { dataset: { id: card.id }, style: `--delay:${i * 80}ms`, tabindex: '0', role: 'button', 'aria-pressed': 'false' },
          h('header.ps-card__head', h('span.ps-card__letter', String.fromCharCode(65 + i)), h('h3.ps-card__lens', card.lens)),
          h('div.ps-card__body', h('p.ps-card__text', renderMarked(card.text, other.text, c.previous))));
        const pick = () => {
          if (locked || writing() || state.accepted) return;
          choice = card.id;
          logEvent('personal.chose', { n: c.n, choice, lens: card.lens });
          render();
        };
        el.addEventListener('click', () => { if (!window.getSelection()?.toString()) pick(); }); // selecting text does not choose
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pick(); } });
        pairEl.append(el);
      });
      pairEl.dataset.n = String(c.n);
      // A long version opens at the first passage where it differs.
      requestAnimationFrame(() => {
        for (const body of pairEl.querySelectorAll('.ps-card__body')) {
          const mark = body.querySelector('.ps-mark--now');
          if (mark && mark.offsetTop > body.clientHeight * 0.6) body.scrollTop = Math.max(0, mark.offsetTop - body.clientHeight / 3);
        }
      });
    }
    for (const el of pairEl.querySelectorAll('.ps-card:not(.ps-card--ghost)')) {
      const on = choice === el.dataset.id;
      el.classList.toggle('is-picked', on);
      el.classList.toggle('is-other', Boolean(choice) && !on);
      el.classList.toggle('is-accepted', state.accepted === el.dataset.id);
      el.setAttribute('aria-pressed', String(on));
    }
  }

  function render() {
    if (destroyed) return;
    const c = comparison();
    const busy = writing();
    const accepted = Boolean(state?.accepted);
    const recording = recordingSeconds !== null;
    renderPair();
    pairEl.classList.toggle('is-writing', busy && Boolean(c));
    status.hidden = !busy;
    headline.textContent = accepted ? t('personal.acceptedHeadline') : c?.aspect || '';
    headline.hidden = !c || (busy && !c);

    // The reason. While recording, the box turns red, with seconds and a level meter.
    noteEl.hidden = !c || accepted;
    noteEl.classList.toggle('is-active', Boolean(choice) && !busy);
    noteEl.classList.toggle('is-recording', recording);
    noteEl.classList.toggle('is-transcribing', transcribing);
    if (!recording) noteLabel.textContent = transcribing ? t('canvas.transcribing') : t(ptt ? 'personal.noteHold' : 'personal.noteStart');
    noteText.textContent = note || (choice === 'neither' ? t('personal.noteNeither') : t('personal.noteHint'));
    noteText.classList.toggle('is-empty', !note);
    noteClear.hidden = !note || voiceBusy();
    micBtn.setAttribute('aria-label', t(ptt ? 'personal.noteHold' : 'personal.noteStart'));
    if (input) {
      if (input.recording) micBtn.disabled = false;
      else input.setEnabled(Boolean(c) && !busy && !locked && !transcribing && !accepted);
    } else micBtn.disabled = true;

    actions.hidden = !c || accepted;
    neitherBtn.classList.toggle('is-on', choice === 'neither');
    neitherBtn.setAttribute('aria-pressed', String(choice === 'neither'));
    neitherBtn.disabled = locked || busy || voiceBusy();
    nextBtn.disabled = locked || busy || !choice || voiceBusy();
    acceptBtn.hidden = !choice || choice === 'neither';
    acceptBtn.disabled = locked || busy || voiceBusy();
    finishBtn.disabled = locked;

    clear(noticeSlot);
    const failed = state?.error ? { key: state.comparison ? 'personal.stepFailed' : 'personal.planFailed', retry: () => refresh({ retry: true }) } : error;
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
      input?.destroy();
      sidebar.destroy();
      waiters.splice(0).forEach((fn) => fn());
    },
  });
}
