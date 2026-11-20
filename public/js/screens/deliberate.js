// Deliberate (personalize): the participant thinks the task through aloud before anything is written.
// The task is in the sidebar; next to an empty email skeleton (grey lines between greeting and closing)
// sit the current question, the microphone and what they have said so far. A time bar runs below; after
// the minimum time "I'm Done Thinking" ends the step, at the limit it ends by itself. The condition
// (scaffold/deliberation.json, chosen per session) decides which questions appear: none (open), fixed
// ones after each recording and after a silence (static), or a question written from what was said
// (adaptive). Ending the step starts the planning on the server (server/routes/personal.js).
import { h, icon, clear, messageStrip } from '../core/dom.js';
import { t } from '../core/strings.js';
import { api } from '../core/api.js';
import { logEvent } from '../core/logEvent.js';
import { createVoiceInput } from '../core/canvas/voiceInput.js';
import { createTaskSidebar } from '../core/canvas/taskSidebar.js';
import { createTimerBar } from '../core/timer/timerBar.js';
import { busy } from '../core/canvas/latestResponse.js';

// Grey lines of the skeleton: relative widths of the lines in each paragraph.
const SKELETON = [[92, 78], [96, 88, 64], [90, 94, 70], [84, 52]];

export default function create() {
  let input = null;
  let ticker = null;
  let gone = false;
  let sidebar = null;
  let devCtx = null;

  return {
    async mount(container, ctx) {
      const { round } = ctx.step;
      const task = ctx.session.task(round);
      const cfg = ctx.config.personal.deliberation;
      const ptt = ctx.config.interaction.recordingMode === 'pushToTalk';

      let view = null; // the server's deliberation state
      let recordingSeconds = null;
      let transcribing = false;
      let thinking = false; // the next question is being written
      let error = null;
      let finishing = false;
      let lastActivity = Date.now();

      // ----- layout -----
      sidebar = createTaskSidebar({ task, round, live: true });
      const intro = h('p.pd-intro');
      const questionText = h('p.pd-question__text');
      const question = h('section.pd-question', { 'aria-live': 'polite' }, h('div.pd-label', icon('question-mark'), h('span', t('deliberate.questionLabel'))), questionText);
      const recBtn = h('button.app-record.pd-rec', { type: 'button' }, icon('microphone', 'fh-icon--l'));
      const recLabel = h('span.pd-rec__label');
      const recStatus = h('span.pd-rec__status', { 'aria-live': 'polite' });
      const meterFill = h('span', { style: 'width:0%' });
      const meter = h('div.fh-progress.pd-meter', { 'aria-hidden': 'true' }, meterFill);
      const said = h('ol.pd-said');
      const saidBox = h('section.pd-saidbox', h('div.pd-label', t('deliberate.saidLabel')), said);
      const notice = h('div.pd-notice');
      const doneBtn = h('button.fh-btn.fh-btn--emphasized.pd-done', { type: 'button' }, icon('accept'), h('span', t('deliberate.done')));
      const doneHint = h('span.pd-done__hint');
      const bar = createTimerBar();
      const skeleton = h('article.pd-skeleton', { 'aria-hidden': 'true' },
        h('p.pd-skeleton__line', t('deliberate.greeting')),
        ...SKELETON.map((para) => h('div.pd-skeleton__para', para.map((w) => h('span.pd-skeleton__bar', { style: `width:${w}%` })))),
        h('p.pd-skeleton__line', t('deliberate.closing')),
        h('span.pd-skeleton__bar.pd-skeleton__bar--short', { style: 'width:28%' }));
      const page = h('div.pd',
        sidebar.el,
        h('div.pd-main',
          h('header.pd-head', h('h1.pd-title', t('deliberate.title')), intro),
          h('div.pd-body',
            h('div.pd-left', skeleton, h('p.pd-skeleton__note', t('deliberate.skeletonNote'))),
            h('div.pd-right',
              question,
              h('div.pd-recrow', recBtn, h('div.pd-rec__text', recLabel, recStatus, meter)),
              notice,
              saidBox)),
          h('footer.pd-foot', h('div.pd-foot__time', h('span.pd-label', t('deliberate.timeLabel')), bar.el), h('div.pd-foot__actions', doneHint, doneBtn))));
      container.append(page);

      const elapsed = () => (view?.startedAt ? (Date.now() - Date.parse(view.startedAt)) / 1000 : 0);
      const currentQuestion = () => [...(view?.items ?? [])].reverse().find((x) => x.kind === 'prompt')?.text ?? null;

      function render() {
        if (gone) return;
        intro.textContent = view?.intro ?? '';
        const q = currentQuestion();
        question.hidden = !q;
        if (q && questionText.textContent !== q) {
          questionText.textContent = q;
          question.classList.remove('is-new');
          void question.offsetWidth;
          question.classList.add('is-new');
        }
        question.classList.toggle('is-thinking', thinking);
        const recording = recordingSeconds !== null;
        recLabel.textContent = recording ? t('deliberate.recording', { seconds: recordingSeconds }) : t(ptt ? 'deliberate.recordHold' : 'deliberate.recordStart');
        recStatus.textContent = transcribing ? t('deliberate.transcribing') : thinking ? t('deliberate.thinking') : ptt && !recording ? t('deliberate.recordHint') : '';
        if (!recording) meterFill.style.width = '0%';
        recBtn.setAttribute('aria-label', recLabel.textContent);
        const items = (view?.items ?? []).filter((x) => x.kind === 'said');
        clear(said).append(...(items.length ? items.map((x) => h('li.pd-said__item', x.text)) : [h('li.pd-said__empty', t('deliberate.empty'))]));
        said.scrollTop = said.scrollHeight;
        clear(notice);
        if (error) notice.append(messageStrip('error', t('deliberate.sayFailed')), error.retry ? h('button.fh-btn', { type: 'button', onclick: () => { const r = error.retry; error = null; r(); } }, t('common.retry')) : '');
        else if (items.length) notice.append(h('p.pd-hint', t('deliberate.moreTalk')));
        const left = Math.ceil((cfg.minSeconds ?? 0) - elapsed());
        doneBtn.disabled = finishing || left > 0 || recording || transcribing || thinking;
        doneHint.textContent = left > 0 ? t('deliberate.doneWait', { seconds: left }) : '';
        if (input) {
          if (input.recording) recBtn.disabled = false;
          else input.setEnabled(!finishing && !transcribing);
        }
      }

      // ----- what was said -----
      async function handleText(text) {
        thinking = view?.condition === 'adaptive';
        error = null;
        lastActivity = Date.now();
        render();
        try {
          view = await api.personal.say(round, text, { signal: AbortSignal.timeout((ctx.config.ai.timeoutSeconds + 10) * 1000) });
          logEvent('deliberate.said', { words: text.split(/\s+/).length, items: view.items.length });
        } catch (e) {
          logEvent('deliberate.sayFailed', { error: e.code ?? e.name });
          error = { retry: () => handleText(text) };
        } finally {
          thinking = false;
          lastActivity = Date.now();
          render();
        }
      }

      input = createVoiceInput(ctx, {
        round,
        button: recBtn,
        log: { target: 'deliberate' },
        onStart() { error = null; recordingSeconds = 0; render(); },
        onTick(s) { recordingSeconds = Math.floor(s); recLabel.textContent = t('deliberate.recording', { seconds: recordingSeconds }); },
        onLevel(l) { meterFill.style.width = `${Math.round(l * 100)}%`; },
        onStop() { recordingSeconds = null; render(); },
        onTranscribing(on) { transcribing = on; render(); },
        onText(text) { handleText(text); },
        onFail() { recordingSeconds = null; render(); },
      });

      // ----- end of the step -----
      async function finish(reason) {
        if (finishing) return;
        finishing = true;
        input?.stop(reason === 'time' ? 'timeLimit' : 'finish');
        render();
        // A recording that was stopped is still transcribed and saved.
        for (let i = 0; i < 60 && (transcribing || thinking); i++) await new Promise((r) => setTimeout(r, 500));
        if (reason === 'time') clear(notice).append(messageStrip('information', t('deliberate.timeUp')));
        try { await api.personal.finishDeliberation(round, reason); } catch { /* the task screen starts the planning too */ }
        logEvent('deliberate.finished', { reason, seconds: Math.round(elapsed()), recordings: (view?.items ?? []).filter((x) => x.kind === 'said').length });
        if (!gone) ctx.flow.next();
      }
      doneBtn.addEventListener('click', () => finish('done'));

      // Dev drawer: end the step now.
      devCtx = ctx.dev;
      if (devCtx) devCtx.finishStep = () => finish('dev');

      try {
        view = await api.personal.deliberationStart(round);
      } catch (e) {
        clear(notice).append(messageStrip('error', t('app.screenError')));
        return;
      }
      if (gone) return;
      if (view.finishedAt) return ctx.flow.next();
      logEvent('deliberate.shown', { condition: view.condition, resumed: view.items.some((x) => x.kind === 'said') });
      bar.update({ elapsedMs: elapsed() * 1000, limitMs: cfg.seconds * 1000, phase: 'running' });
      render();

      ticker = setInterval(async () => {
        const e = elapsed();
        bar.update({ elapsedMs: e * 1000, limitMs: cfg.seconds * 1000, phase: e >= cfg.seconds - 30 ? 'warning' : 'running' });
        if (e >= cfg.seconds && !finishing && recordingSeconds === null) finish('time');
        // Static condition: the next question after a silence.
        if (view?.condition === 'static' && view.intervalSeconds && recordingSeconds === null && !transcribing && !finishing
          && Date.now() - lastActivity > view.intervalSeconds * 1000) {
          lastActivity = Date.now();
          try { view = await api.personal.tick(round); render(); } catch { /* next time */ }
        }
        if (!finishing) render();
      }, 1000);
    },

    unmount() {
      gone = true;
      clearInterval(ticker);
      input?.destroy();
      sidebar?.destroy();
      if (devCtx) devCtx.finishStep = null;
    },
  };
}
