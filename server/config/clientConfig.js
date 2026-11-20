// The client-safe subset of config.js served at /api/config.
// Never include: participant IDs, the system prompt, model names, task-selection lists, the completion code.

export function buildClientConfig({ config, env, modes }) {
  const { flow } = config;
  const enabled = (s) => !(s in flow.enabled) || flow.enabled[s];
  return {
    devMode: env.devMode,
    study: { productName: config.study.productName, locale: config.study.locale },
    flow: {
      pre: flow.pre.filter(enabled),
      round: flow.round.filter(enabled),
      post: flow.post.filter(enabled),
      rounds: flow.rounds,
    },
    interaction: { ...config.interaction },
    tutorial: { ...config.tutorial },
    timer: { ...config.timer },
    ai: { assistantName: config.ai.assistantName, timeoutSeconds: config.ai.timeoutSeconds },
    stt: { timeoutSeconds: config.stt.timeoutSeconds },
    systemCheck: {
      testSentence: config.systemCheck.testSentence,
      maxRecordingSeconds: config.systemCheck.maxRecordingSeconds,
      retriesBeforeContact: config.systemCheck.retriesBeforeContact,
    },
    // Prototyping: the names the welcome screen offers (empty: the ID field).
    participants: { pickList: config.participants.pickList ?? [] },
    personal: { deliberation: { seconds: config.personal.deliberation.seconds, minSeconds: config.personal.deliberation.minSeconds }, offerExport: config.personal.offerExport },
    survey: { type: config.survey.type, externalUrl: config.survey.type === 'external' ? config.survey.externalUrl : null },
    limits: { maxAudioUploadMB: config.limits.maxAudioUploadMB },
    dev: env.devMode ? { timerSpeeds: config.dev.timerSpeeds, modes } : undefined,
  };
}
