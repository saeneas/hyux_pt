// Profile (personalize): after the questionnaire, the participant sees three to six high-level
// preferences as topic and value (scaffold/prompts/profile.md, one small-model call).
import { h, clear, messageStrip } from '../core/dom.js';
import { t } from '../core/strings.js';
import { api } from '../core/api.js';
import { logEvent } from '../core/logEvent.js';

export default function create() {
  let timer = null;
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

      const waiting = () => clear(body).append(h('div.pf-loading', h('span.ps-status__line'), h('span', t('profile.loading'))));

      async function load(retry = false) {
        if (gone) return;
        try {
          const res = await api.personal.profile(round, { retry });
          if (gone) return;
          if (res.profile) {
            const prefs = res.profile.preferences ?? [];
            clear(body).append(h('dl.pf-params', prefs.flatMap((x) => [h('dt', x.topic), h('dd', x.preference)])));
            logEvent('profile.shown', { preferences: prefs.length });
            return;
          }
          if (res.error) {
            clear(body).append(messageStrip('error', t('profile.failed')), h('div.app-actions', h('button.fh-btn', { type: 'button', onclick: () => { waiting(); load(true); } }, t('common.retry'))));
            return;
          }
        } catch { /* try again */ }
        timer = setTimeout(load, 1500);
      }
      waiting();
      load();
    },
    unmount() {
      gone = true;
      clearTimeout(timer);
    },
  };
}
