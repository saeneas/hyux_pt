// What the cards show for orientation, computed from the texts (no model): paragraph by paragraph,
// whether it differs from the other version (bright blue) or changed since the version chosen last
// (greyer blue), whether it moved, and inside changed paragraphs which sentences.
import { h } from '../../core/dom.js';

function sentences(text, offset = 0) {
  const out = [];
  const re = /[^.!?\n]+(?:[.!?]+["”’)]?|(?=\n)|$)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (!m[0].trim()) { if (re.lastIndex === m.index) re.lastIndex++; continue; }
    const lead = m[0].length - m[0].trimStart().length;
    out.push({ start: offset + m.index + lead, end: offset + m.index + m[0].trimEnd().length });
  }
  return out;
}
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const known = (text) => new Set(sentences(text).map((s) => norm(text.slice(s.start, s.end))));

// Paragraphs (separated by a blank line) with their place in the text.
export function paragraphs(text) {
  const out = [];
  const re = /\S[\s\S]*?(?=\n\s*\n|$)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ text: m[0].trimEnd(), start: m.index, end: m.index + m[0].trimEnd().length });
  return out;
}

// Per paragraph: differs (it is not in the other version as it is), changed (it is not in the version
// chosen last), and per character 0 same, 1 changed since the last choice, 2 differs from the other
// version, marked sentence by sentence inside those paragraphs. The grey layer is left out when it would
// cover nearly all of the text (a rewrite tells nothing); the bright one is always shown.
export function analyse(text, other, previous) {
  const paras = paragraphs(text);
  const level = new Uint8Array(text.length);
  const chars = (list) => list.reduce((n, p) => n + p.text.replace(/\s/g, '').length, 0);
  const total = chars(paras) || 1;
  const flags = paras.map(() => ({ differs: false, changed: false }));
  const layer = (against, v, key, limit) => {
    if (!against || against === text) return;
    const paraSet = new Set(paragraphs(against).map((p) => norm(p.text)));
    const hit = paras.map((p) => !paraSet.has(norm(p.text)));
    if (!hit.some(Boolean) || chars(paras.filter((_, i) => hit[i])) > total * limit) return;
    const sentenceSet = known(against);
    paras.forEach((p, i) => {
      if (!hit[i]) return;
      flags[i][key] = true;
      for (const s of sentences(p.text, p.start)) {
        if (sentenceSet.has(norm(text.slice(s.start, s.end)))) continue;
        for (let j = s.start; j < s.end; j++) level[j] = Math.max(level[j], v);
      }
    });
  };
  layer(previous, 1, 'changed', 0.8);
  layer(other, 2, 'differs', 1); // always: both cards mark where they differ
  // Moved: a paragraph both versions have, at another place among the shared paragraphs.
  if (other) {
    const otherKeys = paragraphs(other).map((p) => norm(p.text));
    const keys = paras.map((p) => norm(p.text));
    const shared = keys.filter((k) => otherKeys.includes(k));
    const otherShared = otherKeys.filter((k) => keys.includes(k));
    paras.forEach((p, i) => { const k = keys[i]; if (shared.includes(k) && shared.indexOf(k) !== otherShared.indexOf(k)) flags[i].moved = true; });
  }
  return paras.map((p, i) => ({ ...p, level: level.subarray(p.start, p.end), moved: false, ...flags[i] }));
}

// A paragraph's text as nodes, with <mark> runs for the sentence highlights.
export function markedNodes(p, withMarks) {
  if (!withMarks) return [p.text];
  const nodes = [];
  let start = 0;
  for (let i = 1; i <= p.text.length; i++) {
    if (i < p.text.length && p.level[i] === p.level[start]) continue;
    const part = p.text.slice(start, i);
    nodes.push(p.level[start] === 2 ? h('mark.ps-mark.ps-mark--now', part) : p.level[start] === 1 ? h('mark.ps-mark.ps-mark--before', part) : part);
    start = i;
  }
  return nodes;
}
