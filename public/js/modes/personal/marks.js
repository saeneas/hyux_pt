// Highlights on a card: what the current choice is about (focus, bright blue) and what carries the
// writer's earlier choices (carried, muted blue). The step marks both as phrases copied from the card's
// text (scaffold/prompts/step.md). A phrase is found exactly, else with any white space and case; one that
// is not found is left out. When no focus phrase is found on a full version, the words that differ from
// the other card stand in for it.
import { h } from '../../core/dom.js';
import { changedRanges } from '../compare/diff.js';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function locate(text, phrase) {
  const i = text.indexOf(phrase);
  if (i >= 0) return [i, i + phrase.length];
  const words = phrase.trim().split(/\s+/).filter(Boolean).map(escape);
  if (!words.length) return null;
  const m = new RegExp(words.join('\\s+'), 'iu').exec(text);
  return m ? [m.index, m.index + m[0].length] : null;
}

// Each character of the text: 0 plain, 1 carried, 2 focus (focus wins where both apply).
export function markLevels(card, other) {
  const text = card.text;
  const level = new Uint8Array(text.length);
  const paint = (range, v) => { if (range) for (let i = range[0]; i < range[1]; i++) level[i] = Math.max(level[i], v); };
  for (const p of card.carried ?? []) paint(locate(text, p), 1);
  let focusFound = false;
  for (const p of card.focus ?? []) { const r = locate(text, p); if (r) focusFound = true; paint(r, 2); }
  if (!focusFound && card.kind === 'full' && other?.text) {
    for (const r of changedRanges(other.text, text)) paint([r.start, r.end], 2);
  }
  return level;
}

// The text as nodes: plain runs and <mark> runs.
export function renderMarked(card, other) {
  const text = card.text;
  const level = markLevels(card, other);
  const nodes = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i < text.length && level[i] === level[start]) continue;
    const part = text.slice(start, i);
    nodes.push(level[start] === 2 ? h('mark.ps-mark.ps-mark--now', part) : level[start] === 1 ? h('mark.ps-mark.ps-mark--before', part) : part);
    start = i;
  }
  return { nodes, hasNow: level.includes(2), hasBefore: level.includes(1) };
}
