// Validates config.js and the task data at startup. Collects every problem and reports them together
// in plain language, so a researcher can fix the config without reading code.

const SCREENS = ['welcome', 'systemCheck', 'tutorial', 'briefing', 'deliberate', 'task', 'survey', 'profile', 'interview', 'end'];
const OPTIONAL_SCREENS = ['tutorial', 'survey', 'interview'];

export function validateConfig(config, { tasks, modes, hasApiKey, devMode }) {
  const errors = [];
  const err = (path, msg) => errors.push(`${path}: ${msg}`);
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), config);

  const str = (path, { allowEmpty = false } = {}) => {
    const v = get(path);
    if (typeof v !== 'string' || (!allowEmpty && !v.trim())) err(path, allowEmpty ? 'must be text' : 'must be non-empty text');
  };
  const num = (path, { min = -Infinity, max = Infinity, int = false } = {}) => {
    const v = get(path);
    if (typeof v !== 'number' || Number.isNaN(v)) return err(path, 'must be a number');
    if (int && !Number.isInteger(v)) err(path, 'must be a whole number');
    if (v < min || v > max) err(path, `must be between ${min} and ${max} (is ${v})`);
  };
  const bool = (path) => typeof get(path) === 'boolean' || err(path, 'must be true or false');
  const oneOf = (path, values) => values.includes(get(path)) || err(path, `must be one of ${values.map((v) => `'${v}'`).join(', ')} (is ${JSON.stringify(get(path))})`);

  if (!config || typeof config !== 'object') return ['config.js must export an object'];

  // study
  str('study.id'); str('study.productName'); str('study.locale'); str('study.completionCode', { allowEmpty: true });

  // participants
  const ids = get('participants.validIds');
  if (!Array.isArray(ids) || ids.length === 0) err('participants.validIds', 'must be a non-empty list of IDs');
  else {
    if (ids.some((id) => typeof id !== 'string' || !id.trim())) err('participants.validIds', 'every ID must be non-empty text');
    const norm = ids.map((id) => String(id).trim().toUpperCase());
    const dupes = norm.filter((id, i) => norm.indexOf(id) !== i);
    if (dupes.length) err('participants.validIds', `duplicate IDs: ${[...new Set(dupes)].join(', ')}`);
  }
  bool('participants.allowReuse');

  // flow
  for (const part of ['pre', 'round', 'post']) {
    const list = get(`flow.${part}`);
    if (!Array.isArray(list)) { err(`flow.${part}`, 'must be a list of screen names'); continue; }
    for (const s of list) if (!SCREENS.includes(s)) err(`flow.${part}`, `unknown screen '${s}'. Known screens: ${SCREENS.join(', ')}`);
  }
  if (Array.isArray(get('flow.round')) && !get('flow.round').includes('task')) err('flow.round', "must include 'task'");
  for (const s of OPTIONAL_SCREENS) bool(`flow.enabled.${s}`);
  num('flow.rounds', { min: 1, max: 50, int: true });

  const taskIds = new Set(tasks.map((t) => t.id));
  const checkTaskList = (path, list) => {
    if (!Array.isArray(list)) return err(path, 'must be a list of task IDs');
    for (const id of list) if (!taskIds.has(id)) err(path, `unknown task '${id}'. Tasks in data/tasks.json: ${[...taskIds].join(', ')}`);
    if (new Set(list).size !== list.length) err(path, 'contains the same task twice');
    if (typeof get('flow.rounds') === 'number' && list.length < get('flow.rounds')) {
      err(path, `has ${list.length} task(s) but flow.rounds is ${get('flow.rounds')}. Add tasks or lower flow.rounds.`);
    }
  };
  oneOf('flow.taskSelection.mode', ['fixed', 'random', 'perParticipant']);
  checkTaskList('flow.taskSelection.order', get('flow.taskSelection.order'));
  const per = get('flow.taskSelection.perParticipant') ?? {};
  if (typeof per !== 'object' || Array.isArray(per)) err('flow.taskSelection.perParticipant', 'must be an object of ID: [task IDs]');
  else {
    const valid = new Set((Array.isArray(ids) ? ids : []).map((id) => String(id).trim().toUpperCase()));
    for (const [pid, list] of Object.entries(per)) {
      if (!valid.has(pid.trim().toUpperCase())) err(`flow.taskSelection.perParticipant.${pid}`, 'is not in participants.validIds');
      checkTaskList(`flow.taskSelection.perParticipant.${pid}`, list);
    }
  }

  // interaction
  if (!modes.includes(get('interaction.mode'))) err('interaction.mode', `must be one of the folders in public/js/modes/: ${modes.join(', ')}`);
  oneOf('interaction.recordingMode', ['pushToTalk', 'toggle']);
  num('interaction.maxRecordingSeconds', { min: 3, max: 600 });
  bool('tutorial.practiceTurn');

  // timer
  oneOf('timer.mode', ['hard', 'soft', 'grace']);
  num('timer.graceMinutes', { min: 0.5, max: 60 });
  num('timer.warningSecondsBeforeLimit', { min: 0, max: 3600 });
  num('timer.endNoticeSeconds', { min: 1, max: 60 });

  // ai
  str('ai.assistantName'); str('ai.model'); str('ai.systemPrompt');
  if (get('ai.temperature') !== null) num('ai.temperature', { min: 0, max: 2 });
  if (get('ai.reasoningEffort') !== null) oneOf('ai.reasoningEffort', ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  num('ai.maxOutputTokens', { min: 16, max: 128000, int: true });
  bool('ai.sendHistory');
  num('ai.timeoutSeconds', { min: 5, max: 600 });
  str('ai.intents.extractPrompt'); str('ai.intents.annotatePrompt'); str('ai.intents.reviseInstruction');
  num('ai.intents.maxOutputTokens', { min: 64, max: 32000, int: true });
  num('ai.intents.hedgeAfterSeconds', { min: 0, max: 600 });
  str('ai.compare.initialPrompt'); str('ai.compare.nextPrompt');
  bool('ai.compare.includeSituation');
  num('ai.compare.maxOutputTokens', { min: 256, max: 32000, int: true });

  // personal
  str('personal.deliberation.condition');
  num('personal.deliberation.seconds', { min: 30, max: 900, int: true });
  num('personal.deliberation.minSeconds', { min: 0, max: 900, int: true });
  num('personal.secondsPerComparison', { min: 15, max: 300, int: true });
  num('personal.timeoutSeconds', { min: 10, max: 600 });
  bool('personal.offerExport');
  if (get('logging.modelCalls') !== undefined) bool('logging.modelCalls');
  for (const call of ['adaptive', 'step', 'profile']) {
    str(`personal.calls.${call}.model`);
    if (get(`personal.calls.${call}.reasoningEffort`) !== null) oneOf(`personal.calls.${call}.reasoningEffort`, ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
    num(`personal.calls.${call}.maxOutputTokens`, { min: 64, max: 64000, int: true });
  }
  const picks = get('participants.pickList');
  if (!Array.isArray(picks) || picks.some((x) => typeof x !== 'string' || !x.trim())) err('participants.pickList', 'must be a list of names (or empty)');

  // stt
  str('stt.model');
  const langs = get('stt.languages');
  if (!Array.isArray(langs) || langs.some((l) => typeof l !== 'string' || !/^[a-z]{2,3}$/.test(l))) {
    err('stt.languages', "must be a list of language codes such as ['en'] or ['en', 'de']");
  }
  str('stt.prompt', { allowEmpty: true });
  num('stt.timeoutSeconds', { min: 5, max: 300 });

  // system check
  str('systemCheck.testSentence');
  num('systemCheck.maxRecordingSeconds', { min: 3, max: 60 });
  num('systemCheck.retriesBeforeContact', { min: 0, max: 20, int: true });

  // survey
  oneOf('survey.type', ['internal', 'external']);
  if (get('survey.type') === 'external') {
    try { new URL(get('survey.externalUrl').replace(/\{\w+\}/g, 'x')); } catch { err('survey.externalUrl', 'must be a full URL starting with https://'); }
  }

  // limits
  num('limits.maxAudioUploadMB', { min: 1, max: 25 }); // 25 MB is OpenAI's upload limit
  num('limits.rateLimit.windowSeconds', { min: 1, max: 3600 });
  num('limits.rateLimit.transcribePerWindow', { min: 1, max: 1000, int: true });
  num('limits.rateLimit.chatPerWindow', { min: 1, max: 1000, int: true });
  num('limits.rateLimit.sessionStartPerWindow', { min: 1, max: 1000, int: true });

  // logging
  str('logging.dir'); bool('logging.storeAudio');

  // dev
  str('dev.participantId'); bool('dev.mockByDefault');
  const speeds = get('dev.timerSpeeds');
  if (!Array.isArray(speeds) || !speeds.length || speeds.some((s) => typeof s !== 'number' || s <= 0)) err('dev.timerSpeeds', 'must be a list of positive numbers, e.g. [1, 10, 60]');
  num('dev.mockLatencyMs', { min: 0, max: 10000 });

  // environment
  if (!hasApiKey && !devMode) errors.push('.env: OPENAI_API_KEY is missing. Copy .env.example to .env and add your key.');

  return errors;
}

export function validateTasks(tasks) {
  const errors = [];
  if (!Array.isArray(tasks) || tasks.length === 0) return ['data/tasks.json: must be a non-empty list of tasks'];
  const seen = new Set();
  tasks.forEach((t, i) => {
    const p = `data/tasks.json [${i}]${t?.id ? ` (${t.id})` : ''}`;
    for (const f of ['id', 'title', 'situation', 'task']) if (typeof t?.[f] !== 'string' || !t[f].trim()) errors.push(`${p}: '${f}' must be non-empty text`);
    if (typeof t?.briefing !== 'string') errors.push(`${p}: 'briefing' must be text (may be empty)`);
    if (t?.scaffold !== undefined && typeof t.scaffold !== 'string') errors.push(`${p}: 'scaffold' must be text (may be empty)`);
    if (t?.deliverable !== undefined && typeof t.deliverable !== 'string') errors.push(`${p}: 'deliverable' must be text`);
    if (t?.form !== undefined && !['email', 'document'].includes(t.form)) errors.push(`${p}: 'form' must be 'email' or 'document'`);
    if (typeof t?.timeLimitMinutes !== 'number' || t.timeLimitMinutes <= 0) errors.push(`${p}: 'timeLimitMinutes' must be a positive number`);
    if (t?.materials !== undefined) {
      if (!Array.isArray(t.materials)) errors.push(`${p}: 'materials' must be a list`);
      else t.materials.forEach((m, j) => {
        if (typeof m?.title !== 'string' || typeof m?.body !== 'string') errors.push(`${p}: materials[${j}] needs 'title' and 'body' text`);
      });
    }
    if (seen.has(t?.id)) errors.push(`${p}: duplicate id`);
    seen.add(t?.id);
  });
  return errors;
}
