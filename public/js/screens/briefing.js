// Briefing: an overlay over the (not yet live) canvas with the task's parameters. The timer starts when
// the participant confirms. The task text stays hidden until then, so reading time counts toward the task.
import { h } from '../core/dom.js';
import { t } from '../core/strings.js';
import { openDialog } from '../core/dialog.js';
import { logEvent } from '../core/logEvent.js';

export default function create() {
  let canvas = null;
  let dialog = null;

  return {
    async mount(container, ctx) {
      const { round } = ctx.step;
      const task = ctx.session.task(round);
      const timer = ctx.config.timer;

      // When the deliberation follows, confirming starts the thinking time; the task timer starts with the
      // comparisons (screens/task.js).
      const thinkingNext = ctx.flow.steps[ctx.step.index + 1]?.screen === 'deliberate';
      const startKey = thinkingNext ? 'briefedAt' : 'taskStartedAt';
      // Already confirmed (e.g. dev jump back): go straight on.
      if (ctx.session.progress(round)[startKey]) return ctx.flow.next();

      const mode = await ctx.getMode();
      canvas = mode.createCanvas(ctx, { round, task, live: false, conceal: true });
      container.append(h('div.app-canvas-host', canvas.el));

      const timerText = {
        hard: t('briefing.timerHard'),
        soft: t('briefing.timerSoft'),
        grace: t('briefing.timerGrace', { minutes: timer.graceMinutes }),
      }[timer.mode];

      const start = async () => {
        await ctx.session.updateProgress(round, { taskId: task.id, [startKey]: Date.now() }, { immediate: true });
        logEvent(thinkingNext ? 'task.briefed' : 'task.started', { title: task.title, timeLimitMinutes: task.timeLimitMinutes, timerMode: timer.mode, mode: mode.name });
        dialog.close();
        dialog = null;
        ctx.flow.next();
      };

      dialog = openDialog({
        title: task.title,
        className: 'app-briefing',
        // The whole scenario is read here, before the timer starts. During the task the situation is
        // collapsed and can be opened again.
        content: h('div.app-form',
          task.briefing ? h('p.app-text', task.briefing) : null,
          h('div.app-briefing__block', h('div.fh-attr__label', t('canvas.situationLabel')), h('p.app-text.app-briefing__text', task.situation)),
          h('div.app-briefing__block', h('div.fh-attr__label', t('canvas.taskLabel')), h('p.app-text.app-briefing__text.vc-task__text--strong', task.task)),
          h('div.app-briefing__limit',
            h('span.fh-attr__label', t('briefing.timeLimit')),
            h('span.fh-attr__value.fh-attr__value--large', t('briefing.minutes', { minutes: task.timeLimitMinutes + (thinkingNext ? Math.round((ctx.config.personal?.deliberation?.seconds ?? 0) / 60) : 0) }))),
          h('p.app-text', timerText),
          h('p.app-hint', t('briefing.timerStarts'))),
        actions: [{ label: t('briefing.start'), emphasized: true, onClick: start }],
      });
    },

    unmount() {
      dialog?.close();
      canvas?.destroy();
    },
  };
}
