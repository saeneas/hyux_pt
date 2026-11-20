// Profile (personalize): after the questionnaire, the participant sees what the system inferred about
// how they work: a summary, their approach (strategy), traits along a few dimensions with a confidence
// and the words or choices they rest on, facts they stated, and what is still unclear. The profile is
// made on the server in two passes (scaffold/prompts/profile-evidence.md, profile.md); this screen waits
// for it.
import { h, icon, clear, messageStrip } from '../core/dom.js';
import { t, raw } from '../core/strings.js';
import { api } from '../core/api.js';
import { logEvent } from '../core/logEvent.js';

export default function create() {
  let timer = null;
  let lineTimer = null;
  let gone = false;

  return {
    async mount(container, ctx) {
      const { round } = ctx.step;
      const body = h('div.pf-body');
      const next = h('button.fh-btn.fh-btn--emphasized', { type: 'button' }, t('profile.continue'));
      next.addEventListener('click', () => { logEvent('profile.continued', {}); ctx.flow.next(); });
      container.append(h('div.fh-page.app-page', h('div.fh-page__content.pf',
        h('header.pf-head', h('h1.app-title', t('profile.title')), h('p.app-text', t('profile.intro'))),
        body,
        h('div.app-actions', next))));

      const confidence = (c) => h('span.pf-conf', { title: t('profile.confidence', { percent: Math.round(c * 100) }) },
        h('span.pf-conf__track', h('span.pf-conf__fill', { style: `width:${Math.round(c * 100)}%` })),
        h('span.pf-conf__text', t('profile.confidence', { percent: Math.round(c * 100) })));

      function show(p) {
        const traits = (p.dimensions ?? []).filter((d) => d.dimension !== 'approach');
        clear(body).append(
          h('section.pf-summary', h('div.pf-label', t('profile.summary')), h('p.pf-summary__text', p.summary)),
          h('section.pf-card.pf-card--lead',
            h('div.pf-card__head', h('div.pf-label', t('profile.strategy')), confidence(p.strategy?.confidence ?? 0)),
            h('p.pf-card__title', p.strategy?.statement ?? ''),
            p.strategy?.leading ? h('div.pf-tags', h('span.pf-tag', p.strategy.leading), p.strategy.second ? h('span.pf-tag.pf-tag--second', p.strategy.second) : null) : null),
          traits.length ? h('section.pf-group', h('div.pf-label', t('profile.traits')),
            h('div.pf-grid', traits.map((d, i) => h('article.pf-card', { style: `--delay:${i * 60}ms` },
              h('div.pf-card__head', h('span.pf-dim', d.dimension), confidence(d.confidence ?? 0)),
              h('p.pf-card__title', d.statement),
              d.evidence?.length ? h('details.pf-evidence', h('summary', t('profile.evidence')), h('ul', d.evidence.map((e) => h('li', e)))) : null,
              d.implication ? h('p.pf-implication', h('span', t('profile.implication')), d.implication) : null)))) : null,
          p.facts?.length ? h('section.pf-group', h('div.pf-label', t('profile.facts')),
            h('ul.pf-facts', p.facts.map((f) => h('li', h('span', f.statement), f.quote ? h('q', f.quote) : null)))) : null,
          p.unclear?.length ? h('section.pf-group', h('div.pf-label', t('profile.unclear')),
            h('ul.pf-unclear', p.unclear.map((u) => h('li', icon('question-mark'), h('span', u))))) : null);
      }

      const lines = raw('profile.loading') ?? [];
      let line = 0;
      function waiting() {
        clear(body).append(h('div.pf-loading', h('span.fh-busy', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', lines[line] ?? '')),
          ...[0, 1, 2].map(() => h('div.pf-card.pf-card--ghost', h('span.ps-ghost.ps-ghost--short'), h('span.ps-ghost'), h('span.ps-ghost.ps-ghost--mid'))));
      }

      async function load(retry = false) {
        if (gone) return;
        try {
          const res = await api.personal.profile(round, { retry });
          if (gone) return;
          if (res.profile) {
            clearInterval(lineTimer);
            show(res.profile);
            logEvent('profile.shown', { dimensions: res.profile.dimensions?.length ?? 0, facts: res.profile.facts?.length ?? 0 });
            return;
          }
          if (res.error) {
            clearInterval(lineTimer);
            clear(body).append(messageStrip('error', t('profile.failed')), h('div.app-actions', h('button.fh-btn', { type: 'button', onclick: () => { waiting(); load(true); } }, t('common.retry'))));
            return;
          }
        } catch { /* try again */ }
        timer = setTimeout(load, 2000);
      }
      waiting();
      lineTimer = setInterval(() => { line = Math.min(line + 1, lines.length - 1); if (!body.querySelector('.pf-summary')) waiting(); }, 6000);
      load();
    },
    unmount() {
      gone = true;
      clearTimeout(timer);
      clearInterval(lineTimer);
    },
  };
}
