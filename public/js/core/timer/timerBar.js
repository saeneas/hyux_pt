// Timer bar UI (fh-progress). Mode-independent; the canvas only provides the slot.
// The bar is the only visual reference to time: it shows no countdown in numbers. It fills up to the
// limit, then (grace mode) fills again through the extra time. Phase changes are announced by the
// notices the task screen shows (warning, limit, grace), so the bar itself stays silent.
import { h } from '../dom.js';
import { t } from '../strings.js';

export function createTimerBar() {
  const fill = h('span');
  const bar = h('div.fh-progress.app-timer__bar', {
    role: 'progressbar', 'aria-label': t('timer.label'), 'aria-valuemin': '0', 'aria-valuemax': '100',
  }, fill);
  const el = h('div.app-timer', bar);

  return {
    el,
    update({ elapsedMs, limitMs, phase, phaseRemainingMs, graceMs }) {
      let fraction;
      if (phase === 'grace') fraction = 1 - phaseRemainingMs / graceMs;
      else if (phase === 'overtime' || phase === 'ended') fraction = 1;
      else fraction = elapsedMs / limitMs;
      // Fractions of a percent and a linear transition (app.css) keep the bar moving continuously.
      const percent = Math.min(100, Math.max(0, fraction * 100));
      fill.style.width = `${percent.toFixed(2)}%`;
      bar.setAttribute('aria-valuenow', String(Math.round(percent)));
      el.dataset.phase = phase;
      bar.classList.toggle('fh-progress--warning', phase === 'warning' || phase === 'grace');
      bar.classList.toggle('app-timer__bar--over', phase === 'overtime' || phase === 'ended');
    },
  };
}
