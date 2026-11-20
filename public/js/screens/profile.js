// Profile (personalize): after the questionnaire, the participant sees the preference parameters the
// system inferred from how they worked: a short list of name and value, abstracted from the task so they
// would help in another situation. Made on the server in two passes (scaffold/prompts/profile-evidence.md,
// profile.md); this screen waits for it. Confidence is kept for the dev drawer, not shown here.
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
            const params = res.profile.parameters ?? [];
            clear(body).append(h('dl.pf-params', params.flatMap((x) => [h('dt', x.name), h('dd', x.value)])));
            logEvent('profile.shown', { parameters: params.length });
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
