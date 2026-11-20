// All server calls. The browser never talks to OpenAI directly.
const SESSION_KEY = 'hyux.sessionId';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

let sessionId = null;
try { sessionId = localStorage.getItem(SESSION_KEY); } catch { /* storage blocked: no resume after reload */ }

export function setSessionId(id) {
  sessionId = id;
  try { if (id) localStorage.setItem(SESSION_KEY, id); else localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}
export const getSessionId = () => sessionId;

async function request(method, url, { json, body, signal, keepalive } = {}) {
  const headers = {};
  if (sessionId) headers['X-Session-Id'] = sessionId;
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, headers, body: json !== undefined ? JSON.stringify(json) : body, signal, keepalive });
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') throw e;
    throw new ApiError(0, 'network', e.message);
  }
  if (!res.ok) {
    let code = `http_${res.status}`;
    try { code = (await res.json()).error ?? code; } catch { /* not JSON */ }
    throw new ApiError(res.status, code);
  }
  return res.json();
}

export const api = {
  getConfig: () => request('GET', '/api/config'),
  startSession: (participantId) => request('POST', '/api/session', { json: { participantId } }),
  getSession: () => request('GET', '/api/session'),
  saveState: (state, opts) => request('PUT', '/api/session/state', { json: { state }, ...opts }),
  complete: () => request('POST', '/api/session/complete', { json: {} }),
  log: (events, opts) => request('POST', '/api/log', { json: { events }, ...opts }),
  health: (signal) => request('GET', '/api/health', { signal }),
  transcribe(blob, { purpose = 'task', round = null, filename = 'recording', signal } = {}) {
    const form = new FormData();
    form.append('purpose', purpose);
    if (Number.isInteger(round)) form.append('round', String(round));
    form.append('audio', blob, filename);
    return request('POST', '/api/transcribe', { body: form, signal });
  },
  // Intent cards of the intents mode (server/routes/intents.js).
  intents: {
    start: (round) => request('POST', '/api/intents/start', { json: { round } }),
    extract: (round, text, signal) => request('POST', '/api/intents/extract', { json: { round, text }, signal }),
    annotate: (round, id, text, signal) => request('POST', `/api/intents/${encodeURIComponent(id)}/annotate`, { json: { round, text }, signal }),
    setActive: (round, id, active) => request('PUT', `/api/intents/${encodeURIComponent(id)}`, { json: { round, active } }),
  },
  // Compare mode (server/routes/compare.js).
  compare: {
    start: (round, signal) => request('POST', '/api/compare/start', { json: { round }, signal }),
    next: (round, chosenId, text, signal) => request('POST', '/api/compare/next', { json: { round, chosenId, text }, signal }),
    accept: (round, versionId) => request('POST', '/api/compare/accept', { json: { round, versionId } }),
  },
  // personalize (server/routes/personal.js).
  personal: {
    deliberationStart: (round) => request('POST', '/api/personal/deliberation/start', { json: { round } }),
    say: (round, text, { signal } = {}) => request('POST', '/api/personal/deliberation/say', { json: { round, text }, signal }),
    tick: (round) => request('POST', '/api/personal/deliberation/tick', { json: { round } }),
    finishDeliberation: (round, reason) => request('POST', '/api/personal/deliberation/finish', { json: { round, reason } }),
    state: (round, { seen = false, retry = false } = {}) => request('POST', '/api/personal/state', { json: { round, seen, retry } }),
    act: (round, body) => request('POST', '/api/personal/act', { json: { round, ...body } }),
    undoFailed: (round) => request('POST', '/api/personal/undo-failed', { json: { round } }),
    accept: (round, cardId, note) => request('POST', '/api/personal/accept', { json: { round, cardId, note } }),
    profile: (round, { retry = false } = {}) => request('POST', '/api/personal/profile', { json: { round, retry } }),
  },
  dev: {
    startSession: (participantId, condition) => request('POST', '/api/dev/session', { json: { participantId, condition } }),
    conditions: () => request('GET', '/api/dev/conditions'),
    setCondition: (condition) => request('PUT', '/api/dev/condition', { json: { condition } }),
    inspect: () => request('GET', '/api/dev/inspect'),
    resetRound: (round) => request('POST', '/api/dev/reset-round', { json: { round } }),
    setMock: (mock) => request('PUT', '/api/dev/mock', { json: mock }),
    setMode: (mode) => request('PUT', '/api/dev/mode', { json: { mode } }),
  },
};
