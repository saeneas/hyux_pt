// Highlights on a card, computed from the texts, sentence by sentence: bright blue for the sentences of
// this version that the other one does not have (what the choice is about), a greyer blue for those the
// version chosen last did not have (what the last choice changed). Bright wins where both apply. A
// layer that would cover most of the text tells nothing (the version was rewritten) and is left out.
import { h } from '../../core/dom.js';

// Sentences with their place in the text; the line structure (greeting, paragraphs) stays outside them.
function sentences(text) {
  const out = [];
  const re = /[^.!?\n]+(?:[.!?]+["”’)]?|(?=\n)|$)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (!m[0].trim()) { if (re.lastIndex === m.index) re.lastIndex++; continue; }
    const lead = m[0].length - m[0].trimStart().length;
    out.push({ start: m.index + lead, end: m.index + m[0].trimEnd().length });
  }
  return out;
}
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function differing(text, against) {
  const known = new Set(sentences(against).map((s) => norm(against.slice(s.start, s.end))));
  return sentences(text).filter((s) => !known.has(norm(text.slice(s.start, s.end))));
}

export function renderMarked(text, other, previous) {
  const level = new Uint8Array(text.length);
  const paint = (ranges, v) => {
    const covered = ranges.reduce((n, r) => n + r.end - r.start, 0);
    if (!ranges.length || covered > text.replace(/\s/g, '').length * 0.7) return;
    for (const r of ranges) for (let i = r.start; i < r.end; i++) level[i] = Math.max(level[i], v);
  };
  if (previous && previous !== text) paint(differing(text, previous), 1);
  if (other) paint(differing(text, other), 2);
  const nodes = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i < text.length && level[i] === level[start]) continue;
    const part = text.slice(start, i);
    nodes.push(level[start] === 2 ? h('mark.ps-mark.ps-mark--now', part) : level[start] === 1 ? h('mark.ps-mark.ps-mark--before', part) : part);
    start = i;
  }
  return nodes;
}
