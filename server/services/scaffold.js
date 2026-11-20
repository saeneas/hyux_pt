// Loads the scaffolding logic from scaffold/ (prompts, strategy catalog, deliberation conditions). Files
// are read on every call, so a change to a prompt takes effect at the next call without a restart.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT } from '../config/load.js';

const DIR = path.join(ROOT, 'scaffold');

export async function prompt(name) {
  return (await readFile(path.join(DIR, 'prompts', `${name}.md`), 'utf8')).trim();
}

export async function strategies() {
  return (await readFile(path.join(DIR, 'strategies.md'), 'utf8')).trim();
}

export async function conditions() {
  const data = JSON.parse(await readFile(path.join(DIR, 'deliberation.json'), 'utf8'));
  return data.conditions ?? {};
}
