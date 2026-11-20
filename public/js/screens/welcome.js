// Welcome: short intro and participant ID. The ID is checked on the server only. For prototyping
// (participants.pickList in config.js) a list of names replaces the ID field.
import { h, messageStrip } from '../core/dom.js';
import { t } from '../core/strings.js';
import { api } from '../core/api.js';
import { checkBrowser } from '../core/browserSupport.js';
import { logEvent } from '../core/logEvent.js';

export default function create() {
  return {
    mount(container, ctx) {
      const browser = checkBrowser();
      const names = ctx.config.participants?.pickList ?? [];
      const input = names.length
        ? h('select', { id: 'pid', 'aria-describedby': 'pid-help' }, h('option', { value: '' }, t('welcome.namePlaceholder')), names.map((n) => h('option', { value: n }, n)))
        : h('input', { id: 'pid', type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: t('welcome.idPlaceholder'), 'aria-describedby': 'pid-help', maxlength: '64' });
      const field = h(`span.fh-input${names.length ? '.fh-input--select' : ''}`, input);
      const errorBox = h('div.fh-valuestate.fh-valuestate--error', { id: 'pid-error', role: 'alert', hidden: true });
      const submit = h('button.fh-btn.fh-btn--emphasized', { type: 'submit', disabled: !browser.ok }, t('welcome.submit'));

      const showError = (key) => {
        errorBox.textContent = t(`welcome.errors.${key}`);
        errorBox.hidden = false;
        field.classList.add('fh-input--error');
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', 'pid-error pid-help');
      };
      const clearError = () => {
        errorBox.hidden = true;
        field.classList.remove('fh-input--error');
        input.removeAttribute('aria-invalid');
        input.setAttribute('aria-describedby', 'pid-help');
      };
      input.addEventListener(names.length ? 'change' : 'input', clearError);

      const onSubmit = async (e) => {
        e.preventDefault();
        const id = input.value.trim();
        if (!id) return showError('empty');
        submit.disabled = true;
        try {
          const data = await api.startSession(id);
          ctx.session.set(data);
          logEvent('session.client', { userAgent: browser.userAgent, viewport: `${innerWidth}x${innerHeight}`, browserPreferred: browser.preferred, mobile: browser.mobile });
          const resumeAt = data.state?.flowIndex;
          if (Number.isInteger(resumeAt) && resumeAt > ctx.step.index) await ctx.flow.goTo(resumeAt, { reason: 'resume' });
          else await ctx.flow.next();
        } catch (err) {
          const known = ['invalid_id', 'id_used', 'rate_limited', 'network'];
          showError(known.includes(err.code) ? err.code : 'network');
          submit.disabled = false;
          input.focus();
        }
      };

      const notices = [];
      if (browser.problems.includes('insecure')) notices.push(messageStrip('error', t('welcome.insecure')));
      if (browser.problems.includes('unsupported')) notices.push(messageStrip('error', t('welcome.unsupported')));
      if (browser.mobile) notices.push(messageStrip('warning', t('welcome.mobile')));
      if (browser.ok && !browser.mobile && !browser.preferred) notices.push(messageStrip('information', t('welcome.browserHint')));

      container.append(
        h('div.fh-page.app-page', h('div.fh-page__content.app-center',
          h('form.fh-card.app-card', { onsubmit: onSubmit, novalidate: true },
            h('div.fh-card__header', h('div.fh-card__heading', h('h1.fh-card__title.app-title', t('welcome.title')))),
            h('div.fh-card__content.app-form',
              h('p.app-text', t('welcome.intro')),
              notices,
              h('label.fh-field', { for: 'pid' },
                h('span.fh-label.fh-label--required', t(names.length ? 'welcome.nameLabel' : 'welcome.idLabel')),
                field),
              errorBox,
              names.length ? null : h('p.app-hint', { id: 'pid-help' }, t('welcome.idHelp')),
              h('div.app-actions', submit))))),
      );
      if (browser.ok) input.focus();
    },
    unmount() {},
  };
}
