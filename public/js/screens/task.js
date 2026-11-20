// Task: the live canvas of the configured interaction mode, plus the timer and the end-of-task handling.
// This screen is mode-independent; the canvas comes from the session's mode (ctx.getMode()).createCanvas().
import { h, clear, messageStrip } from '../core/dom.js';
import { t } from '../core/strings.js';
import { openDialog } from '../core/dialog.js';
import { logEvent } from '../core/logEvent.js';
import { createTimer } from '../core/timer/timer.js';
import { createTimerBar } from '../core/timer/timerBar.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default function create() {
  let canvas = null;
  let timer = null;
  let dialog = null;
  let gone = false;
  let devCtx = null;

  return {
    async mount(container, ctx) {
      const { round } = ctx.step;
      const task = ctx.session.task(round);
      const cfg = ctx.config.timer;
      let progress = ctx.session.progress(round);
      let ending = false;
      let finished = false;

      if (progress.finishedAt) return ctx.flow.next();
      const mode = await ctx.getMode();
      if (gone) return;

      canvas = mode.createCanvas(ctx, { round, task, live: true });
      container.append(h('div.app-canvas-host', canvas.el));
      // A canvas that first prepares its content (personal: the plan and the first pair) starts the task
      // time only when it is ready (canvas.ready), so the waiting does not count.
      if (!progress.taskStartedAt && canvas.ready) {
        await canvas.ready;
        if (gone) return;
      }
      if (!progress.taskStartedAt) {
        // No briefing in the flow (or skipped in dev mode): the task starts now.
        ctx.session.updateProgress(round, { taskId: task.id, taskStartedAt: Date.now() }, { immediate: true });
        progress = ctx.session.progress(round);
        logEvent('task.started', { title: task.title, timeLimitMinutes: task.timeLimitMinutes, timerMode: cfg.mode, mode: mode.name, via: 'task' });
      }

      const notice = (design, key, vars) => clear(canvas.noticeSlot).append(messageStrip(design, t(key, vars)));

      async function finish(reason) {
        if (finished || gone) return;
        finished = true;
        timer.stop();
        logEvent('task.finished', { reason, elapsedMs: Math.round(timer.elapsedMs), turns: (ctx.session.data.rounds?.[String(round)]?.turns ?? []).length });
        await ctx.session.updateProgress(round, { finishedAt: Date.now(), finishReason: reason }, { immediate: true });
        if (!gone) ctx.flow.next();
      }

      // Hard limit or end of grace: stop recording (its transcript is still logged), disable input,
      // let a running AI response finish and show it, show a short notice, then move on.
      async function endTask(reason) {
        if (ending || finished) return;
        ending = true;
        dialog?.close();
        canvas.stopRecording('timeLimit');
        canvas.setLocked(true);
        if (canvas.isBusy()) notice('information', 'task.endingWait');
        await canvas.whenIdle();
        if (gone) return;
        dialog = openDialog({ title: t('task.endTitle'), content: h('p.app-text', t('task.endText')) });
        await wait(cfg.endNoticeSeconds * 1000);
        dialog?.close();
        dialog = null;
        finish(reason);
      }

      canvas.onFinishRequest = () => {
        logEvent('task.finishRequested', {});
        dialog = openDialog({
          title: t('task.finishTitle'),
          content: h('p.app-text', t('task.finishText')),
          onCancel: () => { dialog.close(); dialog = null; logEvent('task.finishCancelled', {}); },
          actions: [
            { label: t('task.finishConfirm'), emphasized: true, onClick: async () => {
              dialog.close();
              dialog = null;
              canvas.stopRecording('finish');
              canvas.setLocked(true);
              await canvas.whenIdle();
              finish('user');
            } },
            { label: t('common.cancel'), onClick: () => { dialog.close(); dialog = null; logEvent('task.finishCancelled', {}); } },
          ],
        });
      };

      const bar = createTimerBar();
      canvas.timerSlot.append(bar.el);
      const fired = [...(progress.timerEvents ?? [])];
      timer = createTimer({
        startedAt: progress.taskStartedAt,
        limitMs: task.timeLimitMinutes * 60_000,
        cfg,
        speed: ctx.dev?.timerSpeed ?? 1,
        fired,
        onTick: bar.update,
        onEvent(m, { late }) {
          fired.push(m.event);
          ctx.session.updateProgress(round, { timerEvents: [...fired] }, { immediate: true });
          logEvent(`timer.${m.event}`, { mode: cfg.mode, phase: m.phase, late });
          if (m.event === 'warning') notice('warning', 'task.warning');
          if (m.phase === 'overtime') notice('error', 'task.overtime');
          if (m.phase === 'grace') notice('warning', 'task.grace', { minutes: cfg.graceMinutes });
          if (m.ends) endTask('timeLimit');
        },
      });

      // Restore the notice for a phase that was reached before a reload.
      const phase = timer.phase;
      if (phase === 'warning') notice('warning', 'task.warning');
      if (phase === 'overtime') notice('error', 'task.overtime');
      if (phase === 'grace') notice('warning', 'task.grace', { minutes: cfg.graceMinutes });

      devCtx = ctx.dev;
      if (devCtx) devCtx.onTimerSpeed = (s) => timer.setSpeed(s);
      timer.start();
    },

    unmount() {
      gone = true;
      timer?.stop();
      dialog?.close();
      canvas?.destroy();
      if (devCtx) devCtx.onTimerSpeed = null;
    },
  };
}
