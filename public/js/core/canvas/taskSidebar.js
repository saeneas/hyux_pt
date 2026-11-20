// Task sidebar: the task, the situation and the materials in a panel on the left of the canvas.
//
//   const sidebar = createTaskSidebar({ task, round, live, conceal });
//   sidebar.el          the <aside> (also the "task" region of the tour)
//   sidebar.destroy()
//
// Size and fold, as in common editors and file browsers:
//   - The arrow button in the header folds the panel to a narrow rail; the rail unfolds it again.
//   - The edge between panel and work area drags to resize. Dragging narrower than the minimum snaps the
//     panel shut; dragging a folded panel out unfolds it at the minimum width.
//   - Double click on the edge, or Enter on it, folds and unfolds. Arrow keys resize in steps.
//   - Width and fold are kept for the next task (localStorage), unless the canvas is not live (tour).
// Highlighting: select text in the panel, then pick a colour; "Remove" unmarks what the selection touches,
// "Clear all" removes every mark. Marks are visual help for the participant only. They are not stored and
// not sent anywhere; the log gets only that a mark was made (colour, no text).
import { h, icon } from '../dom.js';
import { t } from '../strings.js';
import { logEvent } from '../logEvent.js';

const STORE = 'taskSidebar';
const MIN_REM = 14; // narrower than this snaps shut
const DEFAULT_REM = 22;
const MAX_REM = 40;
const MAX_SHARE = 0.5; // never wider than half of the window
const STEP_REM = 2;
const RAIL_REM = 3;
// Token-based colours: the --sap…Background tints. Names are in the strings file (canvas.highlight.<key>).
const COLORS = ['yellow', 'green', 'blue', 'pink'];

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
const read = () => { try { return JSON.parse(localStorage.getItem(STORE) ?? 'null'); } catch { return null; } };
const write = (v) => { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* storage unavailable: the size is just not kept */ } };

export function createTaskSidebar({ task, round, live, conceal = false }) {
  const materials = Array.isArray(task?.materials) ? task.materials : [];
  const saved = live ? read() : null;
  let width = Number.isFinite(saved?.width) ? saved.width : DEFAULT_REM * remPx(); // px, of the open panel
  let collapsed = Boolean(saved?.collapsed);
  const bounds = () => ({ min: MIN_REM * remPx(), max: Math.max(MIN_REM * remPx(), Math.min(MAX_REM * remPx(), window.innerWidth * MAX_SHARE)) });
  const clamp = (w) => Math.min(Math.max(w, bounds().min), bounds().max);
  width = clamp(width);

  // ----- content -----
  const body = h('div.ts-body', { id: `ts-body-${round}`, tabindex: '-1' },
    conceal ? null : h('div.ts-block', h('div.vc-task__label', t('canvas.taskLabel')), h('p.vc-task__text.vc-task__text--strong', task?.task ?? '')),
    conceal ? null : h('div.ts-block', h('div.vc-task__label', t('canvas.situationLabel')), h('p.vc-task__text', task?.situation ?? '')),
    !conceal && materials.length ? h('div.ts-materials',
      materials.map((m) => h('section.vc-material', h('h3.vc-material__title', m.title), h('p.vc-material__body', m.body)))) : null);

  // ----- highlighting -----
  const marks = () => [...body.querySelectorAll('mark.ts-mark')];
  const selectionRange = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0).cloneRange();
    if (!range.intersectsNode(body)) return null;
    // A triple click ends at the start of the next block, which can lie outside the panel text: cut the
    // selection to the panel text.
    if (!body.contains(range.startContainer)) range.setStart(body, 0);
    if (!body.contains(range.endContainer)) range.setEnd(body, body.childNodes.length);
    return range.collapsed ? null : range;
  };
  function unwrap(mark) {
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
    parent.normalize();
  }
  // The selection as character offsets in the panel text: marks are added and removed below, and a Range
  // would not survive that.
  function selectedOffsets() {
    const range = selectionRange();
    if (!range) return null;
    const upTo = (node, offset) => {
      const r = document.createRange();
      r.selectNodeContents(body);
      r.setEnd(node, offset);
      return r.toString().length;
    };
    return { range, start: upTo(range.startContainer, range.startOffset), end: upTo(range.endContainer, range.endOffset) };
  }
  // The text nodes (clipped) that lie inside [start, end), without those that are only whitespace.
  function partsBetween(start, end) {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const parts = [];
    let at = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const len = n.nodeValue.length;
      const from = Math.max(start - at, 0);
      const to = Math.min(end - at, len);
      if (to > from && n.nodeValue.slice(from, to).trim()) parts.push({ node: n, from, to });
      at += len;
    }
    return parts;
  }
  // Marks the text between two offsets in a colour: the text nodes are split at the borders and wrapped.
  function paint(start, end, color) {
    if (end <= start) return;
    // From the last part to the first, so the nodes that are still to come stay as they are.
    for (const { node, from, to } of partsBetween(start, end).reverse()) {
      let target = node;
      if (to < target.nodeValue.length) target.splitText(to);
      if (from > 0) target = target.splitText(from);
      const mark = h('mark.ts-mark', { dataset: { color } });
      target.parentNode.insertBefore(mark, target);
      mark.append(target);
    }
  }
  // Colours the selection (or, with color null, unmarks it). Marks that the selection only touches keep
  // their colour outside of it.
  function repaint(color) {
    const sel = selectedOffsets();
    if (!sel) return null;
    const touched = marks().filter((m) => sel.range.intersectsNode(m)).map((m) => {
      const r = document.createRange();
      r.selectNodeContents(body);
      r.setEnd(m, 0);
      const start = r.toString().length;
      return { start, end: start + m.textContent.length, color: m.dataset.color, mark: m };
    });
    touched.forEach((x) => unwrap(x.mark));
    if (color) paint(sel.start, sel.end, color);
    for (const x of touched) {
      paint(x.start, Math.min(x.end, sel.start), x.color);
      paint(Math.max(x.start, sel.end), x.end, x.color);
    }
    window.getSelection().removeAllRanges();
    return touched.length;
  }
  function applyColor(color) {
    if (repaint(color) === null) return;
    if (live) logEvent('taskSidebar.highlight', { color, marks: marks().length });
  }
  function removeSelected() {
    const removed = repaint(null);
    if (removed && live) logEvent('taskSidebar.highlightRemoved', { removed, marks: marks().length });
  }
  function clearAll() {
    const all = marks();
    all.forEach(unwrap);
    if (all.length && live) logEvent('taskSidebar.highlightsCleared', { removed: all.length });
    updateTools();
  }

  // A button must not take the selection away from the text when it is pressed.
  const keepSelection = (e) => e.preventDefault();
  const swatches = COLORS.map((color) => {
    const b = h('button.ts-swatch', { type: 'button', dataset: { color }, title: t(`canvas.highlight.${color}`), 'aria-label': t('canvas.highlight.apply', { color: t(`canvas.highlight.${color}`) }) });
    b.addEventListener('mousedown', keepSelection);
    b.addEventListener('click', () => { applyColor(color); updateTools(); });
    return b;
  });
  const removeBtn = h('button.fh-btn.fh-btn--transparent', { type: 'button', title: t('canvas.highlight.removeTitle') }, t('canvas.highlight.remove'));
  removeBtn.addEventListener('mousedown', keepSelection);
  removeBtn.addEventListener('click', () => { removeSelected(); updateTools(); });
  const clearBtn = h('button.fh-btn.fh-btn--transparent.ts-clear', { type: 'button' }, t('canvas.highlight.clearAll'));
  clearBtn.addEventListener('click', clearAll);
  const tools = h('div.ts-tools', { role: 'group', 'aria-label': t('canvas.highlight.label') },
    h('span.ts-tools__label', t('canvas.highlight.label')), h('span.ts-swatches', swatches), removeBtn, clearBtn);
  function updateTools() {
    const hasSelection = Boolean(selectionRange());
    swatches.forEach((b) => { b.disabled = !hasSelection; });
    removeBtn.disabled = !hasSelection;
    clearBtn.disabled = marks().length === 0;
  }
  const onSelection = () => updateTools();
  document.addEventListener('selectionchange', onSelection);
  updateTools();

  // ----- fold and resize -----
  const title = h('h1.ts-title', task?.title ?? '');
  const foldBtn = h('button.fh-btn.fh-btn--transparent.fh-btn--icon.ts-fold', { type: 'button', 'aria-controls': body.id });
  const railBtn = h('button.ts-rail', { type: 'button', 'aria-controls': body.id }, icon('slim-arrow-right'), h('span.ts-rail__label', t('canvas.taskLabel')));
  const handle = h('div.ts-handle', {
    role: 'separator', 'aria-orientation': 'vertical', tabindex: '0', title: t('canvas.sidebar.resize'), 'aria-label': t('canvas.sidebar.resizeLabel'),
  });
  const panel = h('div.ts-panel', h('div.ts-head', title, foldBtn), conceal ? null : tools, body);
  const el = h('aside.ts', { 'aria-label': t('canvas.taskLabel'), dataset: { region: 'task' } }, railBtn, panel, handle);

  function apply({ persist = false, log = null } = {}) {
    el.classList.toggle('is-collapsed', collapsed);
    el.style.setProperty('--ts-width', `${Math.round(collapsed ? RAIL_REM * remPx() : width)}px`);
    foldBtn.setAttribute('aria-expanded', String(!collapsed));
    railBtn.setAttribute('aria-expanded', String(!collapsed));
    foldBtn.title = railBtn.title = t(collapsed ? 'canvas.sidebar.show' : 'canvas.sidebar.hide');
    foldBtn.setAttribute('aria-label', t('canvas.sidebar.hide'));
    railBtn.setAttribute('aria-label', t('canvas.sidebar.show'));
    foldBtn.replaceChildren(icon('slim-arrow-left'));
    panel.inert = collapsed; // a folded panel takes no focus and is not read out
    handle.setAttribute('aria-valuemin', String(Math.round(bounds().min)));
    handle.setAttribute('aria-valuemax', String(Math.round(bounds().max)));
    handle.setAttribute('aria-valuenow', String(Math.round(collapsed ? 0 : width)));
    if (persist && live) write({ width: Math.round(width), collapsed });
    if (log && live) logEvent(log, { width: Math.round(collapsed ? 0 : width) });
  }
  function setCollapsed(on, how) {
    if (collapsed === on) return;
    collapsed = on;
    apply({ persist: true, log: on ? 'taskSidebar.collapsed' : 'taskSidebar.expanded' });
    (on ? railBtn : foldBtn).focus({ preventScroll: true });
    if (live) logEvent('taskSidebar.toggled', { collapsed: on, via: how });
  }
  foldBtn.addEventListener('click', () => setCollapsed(true, 'button'));
  railBtn.addEventListener('click', () => setCollapsed(false, 'rail'));

  // Dragging: the width follows the pointer; below the minimum the panel previews as folded.
  let drag = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    handle.setPointerCapture(e.pointerId);
    drag = { left: el.getBoundingClientRect().left, wasCollapsed: collapsed, startWidth: width, moved: false };
    el.classList.add('is-dragging');
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.moved = true;
    const raw = e.clientX - drag.left;
    if (raw < bounds().min * 0.7) { // clearly below the minimum: preview the folded rail
      collapsed = true;
    } else {
      collapsed = false;
      width = Math.min(Math.max(raw, bounds().min), bounds().max); // snaps to the minimum, never smaller
    }
    apply();
  });
  const endDrag = () => {
    if (!drag) return;
    const { wasCollapsed, startWidth, moved } = drag;
    drag = null;
    el.classList.remove('is-dragging');
    if (!moved) return;
    if (collapsed && !wasCollapsed) width = startWidth; // reopens at the size it had before it was folded
    apply({ persist: true, log: collapsed ? 'taskSidebar.collapsed' : 'taskSidebar.resized' });
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('dblclick', () => setCollapsed(!collapsed, 'doubleClick'));
  handle.addEventListener('keydown', (e) => {
    const step = STEP_REM * remPx();
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed(!collapsed, 'keyboard'); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    if (collapsed) { if (e.key === 'ArrowRight') setCollapsed(false, 'keyboard'); return; }
    const next = width + (e.key === 'ArrowRight' ? step : -step);
    if (next < bounds().min) { setCollapsed(true, 'keyboard'); return; }
    width = clamp(next);
    apply({ persist: true, log: 'taskSidebar.resized' });
  });

  const onResize = () => { width = clamp(width); apply(); };
  window.addEventListener('resize', onResize);
  apply();

  return {
    el,
    destroy() {
      document.removeEventListener('selectionchange', onSelection);
      window.removeEventListener('resize', onResize);
    },
  };
}
