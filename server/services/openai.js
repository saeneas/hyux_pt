// Real speech-to-text and LLM calls. The API key stays on the server.
// Interface (shared with mock.js):
//   transcribe({ buffer, mimetype, filename, signal }) -> { text }
//   respond({ messages, onDelta, signal }) -> { text, usage }
//   structured({ kind, instructions, input, schema, signal, maxOutputTokens?, hedgeAfterSeconds?, context? })
//     -> { data, usage, attempt?, attempts? }   (JSON that matches schema; maxOutputTokens and hedgeAfterSeconds
//     default to ai.intents; kind and context only matter to the mock)
//   health({ signal }) -> { ok, model }
import OpenAI, { toFile } from 'openai';

// Runs run(signal); if it has not settled after `after` ms, runs it a second time in parallel. Resolves
// with the first success ({ ...result, attempt, attempts }: which request won, how many were started),
// cancels the other, and rejects only when every started request failed. A failure before the second
// request has started is final (the SDK has already retried it).
export function hedged(run, { signal, after }) {
  return new Promise((resolve, reject) => {
    const runs = [];
    let done = false;
    let timer = null;
    const finish = (settle, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const r of runs) r.ctrl.abort();
      settle(value);
    };
    const launch = () => {
      if (done || signal?.aborted) return;
      const ctrl = new AbortController();
      const entry = { ctrl, failed: false };
      runs.push(entry);
      const attempt = runs.length;
      run(signal ? AbortSignal.any([signal, ctrl.signal]) : ctrl.signal).then(
        (value) => finish(resolve, { ...value, attempt, attempts: runs.length }),
        (e) => {
          entry.failed = true;
          if (runs.every((r) => r.failed)) finish(reject, e);
        },
      );
    };
    launch();
    timer = setTimeout(launch, after);
  });
}

export function createOpenAiService({ config, env }) {
  const client = env.hasApiKey ? new OpenAI({ apiKey: env.apiKey, maxRetries: 1 }) : null;
  const need = () => {
    if (!client) throw Object.assign(new Error('OPENAI_API_KEY is not set'), { code: 'no_api_key' });
    return client;
  };

  // model and reasoningEffort: per call (the personalize calls choose their own), else config.ai.
  function requestParams(input, { stream, maxOutputTokens = config.ai.maxOutputTokens, instructions = config.ai.systemPrompt, model = config.ai.model, reasoningEffort = config.ai.reasoningEffort } = {}) {
    const p = {
      model,
      instructions,
      input,
      max_output_tokens: maxOutputTokens,
      store: false,
      stream,
    };
    if (config.ai.temperature !== null) p.temperature = config.ai.temperature;
    if (reasoningEffort) p.reasoning = { effort: reasoningEffort };
    return p;
  }

  return {
    async transcribe({ buffer, mimetype, filename, signal }) {
      const file = await toFile(buffer, filename, { type: mimetype });
      const params = { file, model: config.stt.model, languages: config.stt.languages };
      if (config.stt.prompt) params.prompt = config.stt.prompt;
      const res = await need().audio.transcriptions.create(params, { signal });
      return { text: (res.text ?? '').trim() };
    },

    // messages: [{ role: 'user' | 'assistant', content: string }]
    async respond({ messages, onDelta, signal }) {
      const stream = Boolean(onDelta);
      const res = await need().responses.create(requestParams(messages, { stream }), { signal });
      if (!stream) return { text: res.output_text ?? '', usage: res.usage ?? null };
      let text = '';
      let usage = null;
      for await (const ev of res) {
        if (ev.type === 'response.output_text.delta') { text += ev.delta; onDelta(ev.delta); }
        else if (ev.type === 'response.completed') usage = ev.response?.usage ?? null;
        else if (ev.type === 'error' || ev.type === 'response.failed') {
          throw new Error(ev.message ?? ev.response?.error?.message ?? 'The model returned an error');
        }
      }
      return { text, usage };
    },

    // Short calls the participant waits for (intents). Usually 2–3 s, but now and then one request takes
    // much longer at the API. So if no answer has come after ai.intents.hedgeAfterSeconds, a second,
    // identical request starts; the first answer wins and the other request is cancelled.
    async structured({ instructions, input, schema, signal, maxOutputTokens = config.ai.intents.maxOutputTokens, hedgeAfterSeconds = config.ai.intents.hedgeAfterSeconds, model, reasoningEffort }) {
      const params = requestParams(input, { stream: false, maxOutputTokens, instructions, model, reasoningEffort });
      params.text = { format: { type: 'json_schema', name: 'result', schema, strict: true } };
      const once = async (sig) => {
        const res = await need().responses.create(params, { signal: sig });
        let data;
        try { data = JSON.parse(res.output_text ?? ''); } catch {
          const why = res.status === 'incomplete' ? ` (incomplete: ${res.incomplete_details?.reason ?? 'unknown'})` : '';
          throw new Error(`The model did not return valid JSON${why}`);
        }
        return { data, usage: res.usage ?? null, model: params.model };
      };
      const after = (hedgeAfterSeconds ?? 0) * 1000;
      return after > 0 ? hedged(once, { signal, after }) : once(signal);
    },

    async health({ signal }) {
      const res = await need().responses.create(
        requestParams([{ role: 'user', content: 'Reply with the word OK.' }], { stream: false, maxOutputTokens: 256 }),
        { signal },
      );
      return { ok: Boolean(res.id) && res.status !== 'failed', model: res.model };
    },
  };
}
