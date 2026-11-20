// Survey after each task. survey.type 'internal' renders content/survey.<locale>.js and sends the answers
// to the logger; 'external' links to an outside survey with the participant ID, round and task ID in the URL.
import { h, messageStrip } from '../core/dom.js';
import { t } from '../core/strings.js';
import { logEvent } from '../core/logEvent.js';
import { api } from '../core/api.js';

export default function create() {
  return {
    async mount(container, ctx) {
      const { round } = ctx.step;
      const task = ctx.session.task(round);
      // personalize: the profile is inferred while the questionnaire is answered (it starts at the latest
      // here; usually already when the final text was chosen).
      if (ctx.session.data?.mode === 'personal') api.personal.profile(round).catch(() => {});
      const page = (...children) => container.append(h('div.fh-page.app-page', h('div.fh-page__content.app-center', ...children)));
      const done = async () => {
        await ctx.session.updateProgress(round, { surveyAt: new Date().toISOString() }, { immediate: true });
        ctx.flow.next();
      };

      if (ctx.config.survey.type === 'external') {
        const url = ctx.config.survey.externalUrl
          .replaceAll('{participantId}', encodeURIComponent(ctx.session.data.participantId))
          .replaceAll('{round}', encodeURIComponent(round))
          .replaceAll('{taskId}', encodeURIComponent(task?.id ?? ''));
        // "I Have Finished" unlocks once the questionnaire was opened, also after a reload.
        const opened = Boolean(ctx.session.progress(round).surveyOpenedAt);
        const doneBtn = h('button.fh-btn.fh-btn--emphasized', { type: 'button', disabled: !opened, onclick: () => { doneBtn.disabled = true; logEvent('survey.externalDone', {}); done(); } }, t('survey.externalDone'));
        const openBtn = h('a.fh-btn', { href: url, target: '_blank', rel: 'noopener', onclick: () => {
          logEvent('survey.externalOpened', {});
          ctx.session.updateProgress(round, { surveyOpenedAt: new Date().toISOString() }, { immediate: true });
          doneBtn.disabled = false;
        } }, t('survey.externalOpen'));
        return page(h('section.fh-card.app-card',
          h('div.fh-card__header', h('div.fh-card__heading', h('h1.fh-card__title.app-title', t('survey.externalTitle')), task && h('div.fh-card__subtitle', task.title))),
          h('div.fh-card__content.app-form', h('p.app-text', t('survey.externalText')), h('div.app-actions', openBtn, doneBtn))));
      }

      const survey = (await import(`/content/survey.${ctx.config.study.locale}.js`)).default;
      // Answers are kept in the round state while the participant fills in the form, so a reload keeps them.
      const answers = { ...(ctx.session.progress(round).surveyDraft ?? {}) };
      const keep = () => ctx.session.updateProgress(round, { surveyDraft: answers });
      const errors = {};

      const field = (q, i) => {
        const id = `q-${q.id}`;
        const err = h('div.fh-valuestate.fh-valuestate--error', { id: `${id}-err`, hidden: true }, t('survey.required'));
        errors[q.id] = err;
        let control;
        if (q.type === 'scale' || q.type === 'choice') {
          const values = q.type === 'scale' ? Array.from({ length: q.max - q.min + 1 }, (_, k) => q.min + k) : q.options;
          const chips = values.map((v) => h('button.fh-chip', { type: 'button', role: 'radio', 'aria-checked': 'false', dataset: { value: String(v) } }, String(v)));
          const mark = (chip) => chips.forEach((c) => { c.setAttribute('aria-checked', String(c === chip)); c.tabIndex = c === chip ? 0 : -1; });
          const select = (chip) => {
            mark(chip);
            answers[q.id] = q.type === 'scale' ? Number(chip.dataset.value) : chip.dataset.value;
            err.hidden = true;
            keep();
          };
          chips.forEach((c, k) => {
            c.tabIndex = k === 0 ? 0 : -1;
            c.addEventListener('click', () => select(c));
            c.addEventListener('keydown', (e) => { // arrow keys move within the group, as in a radio group
              const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
              if (!dir) return;
              e.preventDefault();
              const nextChip = chips[(k + dir + chips.length) % chips.length];
              select(nextChip);
              nextChip.focus();
            });
          });
          const saved = chips.find((c) => c.dataset.value === String(answers[q.id]));
          if (saved) mark(saved);
          control = h(`div.fh-chips.app-choice${q.type === 'scale' ? '.app-choice--scale' : ''}`, { role: 'radiogroup', 'aria-labelledby': `${id}-label`, 'aria-describedby': `${id}-err` }, chips);
          if (q.type === 'scale') control = h('div.app-scale', control, h('div.app-scale__labels', h('span', q.minLabel ?? ''), h('span', q.maxLabel ?? '')));
        } else {
          const ta = h('textarea', { id, rows: '3', placeholder: t('survey.textPlaceholder'), 'aria-labelledby': `${id}-label`, maxlength: '2000' });
          ta.value = answers[q.id] ?? '';
          ta.addEventListener('input', () => { answers[q.id] = ta.value.trim(); err.hidden = true; keep(); });
          control = h('span.fh-input.app-textarea', ta);
        }
        return h('fieldset.app-question',
          h('legend.app-question__text', { id: `${id}-label` }, `${i + 1}. ${q.text}`, q.required ? null : h('span.app-hint', ` (${t('survey.optional')})`)),
          control, err);
      };

      const summary = h('div');
      const submit = h('button.fh-btn.fh-btn--emphasized', { type: 'submit' }, t('survey.submit'));
      const onSubmit = async (e) => {
        e.preventDefault();
        const missing = survey.questions.filter((q) => q.required && (answers[q.id] === undefined || answers[q.id] === ''));
        missing.forEach((q) => { errors[q.id].hidden = false; });
        summary.replaceChildren(...(missing.length ? [messageStrip('error', t('survey.missing'))] : []));
        if (missing.length) return container.querySelector(`#q-${missing[0].id}, [aria-labelledby="q-${missing[0].id}-label"] [tabindex="0"]`)?.focus();
        submit.disabled = true;
        logEvent('survey.submitted', { answers });
        done();
      };

      page(h('form.fh-card.app-card.app-card--wide', { onsubmit: onSubmit, novalidate: true },
        h('div.fh-card__header', h('div.fh-card__heading', h('h1.fh-card__title.app-title', survey.title), task && h('div.fh-card__subtitle', task.title))),
        h('div.fh-card__content.app-form',
          survey.intro ? h('p.app-text', survey.intro) : null,
          survey.questions.map(field),
          summary,
          h('div.app-actions', submit))));
    },
    unmount() {},
  };
}
