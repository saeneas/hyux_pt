// Study configuration: the single source of truth for every study decision.
// Secrets and environment settings (OPENAI_API_KEY, PORT, DEV_MODE) live in .env, not here.
// The server validates this file at startup (server/config/validate.js) and sends only a
// client-safe subset to the browser (server/config/clientConfig.js). See README.md for every option.

export default {
  study: {
    id: 'hyux-formative-01',
    productName: 'Sales Workbench', // plain text in the ShellBar; no logos
    locale: 'en', // loads content/strings.<locale>.js and content/survey.<locale>.js
    completionCode: '', // shown on the end screen if not empty
  },

  participants: {
    // Valid participant IDs. Never sent to the browser. Matching ignores case and surrounding spaces.
    validIds: ['Marcus', 'Lisa', 'Duchy', 'Aeneas'],
    // Prototyping: the welcome screen offers these names in a list instead of an ID field (they are then
    // sent to the browser). Empty: the ID field.
    pickList: ['Marcus', 'Lisa', 'Duchy', 'Aeneas'],
    // false: an ID can start one session. Entering it again resumes that session until it is
    // completed; after that the ID is rejected. true: every entry starts a new session.
    allowReuse: true,
  },

  flow: {
    // Screen order. Screens are modules in public/js/screens/. Reordering here reorders the study.
    // personalize: read the task (briefing), think it through aloud (deliberate), find the text through
    // guided comparisons (task), answer the questionnaire (survey), see the inferred profile (profile).
    pre: ['welcome'],
    round: ['briefing', 'deliberate', 'task', 'survey', 'profile'],
    post: ['end'],
    // Optional screens. A screen set to false is skipped.
    enabled: { tutorial: false, survey: true, interview: false },
    rounds: 2, // N
    taskSelection: {
      mode: 'fixed', // 'fixed' | 'random' | 'perParticipant'
      order: ['task-01', 'task-02'], // used by 'fixed'; 'random' shuffles this list per participant
      // used by 'perParticipant'; IDs not listed here fall back to 'order'
      perParticipant: {
        // P01: ['task-02', 'task-01', 'task-03'],
      },
    },
  },

  interaction: {
    // Default interaction mode for new sessions (a folder in public/js/modes/). In dev mode the dev panel
    // can switch the current session.
    //   'voice'   : spoken instructions build the instruction; each send goes to the AI with the history.
    //   'compare' : two similar versions side by side. The participant picks one and says what they like
    //               most about it; that feeds a hidden preference profile, the other version is replaced
    //               by a new one written from the profile, until the participant accepts a version.
    //   'intents' : the task starts from its generic starting draft (`scaffold` in data/tasks.json; without
    //               one, the first instruction is sent as spoken). Each recording is split into intent
    //               cards that can be switched off or changed by voice; a send hands the AI only the
    //               active intents and the latest draft.
    //   'personal': guided comparisons planned from the deliberation (branch personalize; see scaffold/).
    mode: 'personal',
    recordingMode: 'pushToTalk', // 'pushToTalk' (hold button or Space) | 'toggle' (click to start, click to stop)
    maxRecordingSeconds: 180, // thinking aloud runs long; a recording stops by itself after this
  },

  tutorial: {
    practiceTurn: true, // end the tutorial with one real recording sent to the AI
  },

  timer: {
    mode: 'grace', // 'hard' | 'soft' | 'grace'
    graceMinutes: 2, // 'grace' only
    warningSecondsBeforeLimit: 60,
    endNoticeSeconds: 5, // 'hard' and end of 'grace': how long the notice shows before the study moves on
  },

  ai: {
    assistantName: 'Sales Assistant', // job-based name, never a human name
    model: 'gpt-6.2-sol',
    systemPrompt:
      'You are a writing assistant for sales professionals. You receive spoken instructions that were ' +
      'transcribed automatically, so they may contain recognition errors; interpret them sensibly. ' +
      'Do what the instruction asks. Answer with the requested text only: no introduction (such as ' +
      '"Here is the revised version:"), no label or heading about the text, and no comment, note or ' +
      'offer after it. If an instruction is unclear, make a reasonable assumption without mentioning it. ' +
      'Write plain text without Markdown formatting; use line breaks for structure.',
    temperature: null, // null = not sent. gpt-6.2-sol and gpt-6.2-astra do not accept temperature.
    reasoningEffort: 'low', // null = not sent; otherwise 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    maxOutputTokens: 1500,
    sendHistory: true, // include earlier turns of the current task
    timeoutSeconds: 60, // also used for the AI check in the system check
    // Prompts of the 'intents' mode. The base systemPrompt above is used for writing the draft; these
    // are separate calls. The model never sees the task here either.
    intents: {
      extractPrompt:
        'You turn a spoken comment about a draft into intents: short, self-contained change requests for ' +
        'the draft, each with the reason the speaker gave for it. The comment was transcribed ' +
        'automatically and may contain recognition errors. Split the comment into one intent per distinct ' +
        'request; most comments contain one or two. For each intent return: text, the request as an ' +
        'imperative in at most 12 words, in the language of the comment (for example "Mention the six-week ' +
        'rollout"), resolving references such as "that part" using the draft; reason, why the speaker ' +
        'wants it, in at most 15 words and in their terms (for example "The CFO cares about the cost of ' +
        'turnover"), taken only from what they said or clearly meant, never a reason of your own, and an ' +
        'empty string if they gave none; quote, the words of the comment the intent comes from, copied ' +
        'exactly. Leave out filler. If the comment contains no request, return no intents.',
      annotatePrompt:
        'You update one intent (a short change request for a draft, with the reason the author gave for ' +
        'it) according to a spoken annotation. The annotation was transcribed automatically and may ' +
        'contain recognition errors. Return text, the updated intent as an imperative in at most 12 words, ' +
        'in the language of the intent: if the annotation replaces the intent, the new one; if it adds a ' +
        'detail, merged. Return reason in at most 15 words: the current reason, updated or extended if the ' +
        'annotation gives a new or further reason; never a reason of your own, and an empty string if ' +
        'there is none.',
      reviseInstruction:
        'Revise the current draft below so that it follows every intent in the list. Some intents give ' +
        'the author\'s reason in brackets: use it to decide how to carry the intent out and what to ' +
        'emphasise, since it shows what the author has in mind. Keep everything the intents do not ask to ' +
        'change. The draft may contain placeholders in square brackets: fill one only when the intents ' +
        'give what it needs, otherwise keep it as it is. Answer with the full revised draft only, starting ' +
        'with its first line: do not introduce it, describe what you changed or add notes.',
      maxOutputTokens: 600, // for extracting and annotating intents
      // A second, identical intent request starts if the first has not answered after this many seconds;
      // the first answer is used. Cuts the rare very slow request (seen: 21 s instead of 2–3 s). 0 = off.
      hedgeAfterSeconds: 5,
    },
    // Prompts of the 'compare' mode (structured calls). The model sees the outline (the task's scaffold),
    // the situation (if includeSituation) and, after the first pair, the hidden profile, the picked and
    // the rejected version and what the participant said. Never the task itself.
    compare: {
      initialPrompt:
        'Write two versions of the text that the outline describes, for its reader. Both follow the outline, ' +
        'use only facts from the situation (do not invent figures, names or dates; keep a placeholder in ' +
        'square brackets where a fact is missing) and have about the same length. Make them similar but not ' +
        'the same: let them differ clearly in two or three choices a writer would make here, for example the ' +
        'tone, what the text leads with, how hard it argues, which argument carries it, or how it handles a ' +
        'weak point. Keep everything else alike, so a reader can tell what the difference is. Return a and b, ' +
        'the two full texts (plain text without Markdown, no introduction or comment), and differences, one ' +
        'short line per choice in which they differ (for example "A leads with cost savings, B with nurse ' +
        'retention").',
      nextPrompt:
        'You help an author find the version of a text they want, one comparison at a time, and keep a hidden ' +
        'profile of their preferences: short statements of what they want from this text, learned from their ' +
        'choices. You receive the profile so far, the version they just picked, the version they rejected and ' +
        'what they said they like most about their pick (transcribed automatically; it may contain ' +
        'recognition errors). First update the profile: add what this choice and their words reveal, sharpen ' +
        'or correct earlier statements and drop those this choice contradicts. Statements are concrete (for ' +
        'example "Leads with nurse retention, not price"), at most 15 words each and at most 12 in total; ' +
        'keep only what the choices and words support. Then write a new version to compare with the pick: ' +
        'start from the pick, keep everything the profile settles, and change one or two aspects the profile ' +
        'does not settle yet, so the next choice teaches something new. The more settled the profile and the ' +
        'later the round, the smaller and subtler the difference. Keep the length and structure close to the ' +
        'pick and use only facts from the situation. Return profile (the updated statements), challenger (the ' +
        'full new text, plain text without Markdown, no introduction or comment) and differences (one short ' +
        'line per aspect in which it differs from the pick).',
      includeSituation: true, // the participant gives no facts in this mode, so the model sees the situation
      maxOutputTokens: 4000, // two full versions in the first call
    },
  },

  // personalize: deliberation, planning, guided comparisons and the profile. The logic itself (prompts,
  // strategy catalog, deliberation conditions) is in scaffold/ and read on every call.
  personal: {
    deliberation: {
      condition: 'adaptive', // default for new sessions: a key of scaffold/deliberation.json (open | static | adaptive)
      seconds: 180, // time for thinking aloud; at the end the step closes
      minSeconds: 60, // "I'm Done" is possible after this long
    },
    // Time budget of the comparisons: the task's timeLimitMinutes, divided by about this many seconds per
    // pair, tells the planner and each step how many pairs are left.
    secondsPerComparison: 45,
    // Model and reasoning effort per call. Routing calls run on a small model; planning and the profile
    // on the large one.
    calls: {
      adaptive: { model: 'gpt-6-luna', reasoningEffort: 'none', maxOutputTokens: 300 },
      step: { model: 'gpt-6-luna', reasoningEffort: 'none', maxOutputTokens: 4000 }, // the first pair and every next one (about 5 s)
      evidence: { model: 'gpt-6-luna', reasoningEffort: 'none', maxOutputTokens: 3000 },
      profile: { model: 'gpt-6.2-sol', reasoningEffort: 'low', maxOutputTokens: 5000 },
    },
    timeoutSeconds: 120, // per call; the participant sees progress meanwhile
    // The end screen offers the session as a file (what was said and chosen, plans, cards, profiles), for
    // test sessions with colleagues. scripts/replay.mjs runs such a file again against changed prompts.
    offerExport: true,
  },

  stt: {
    model: 'gpt-transcribe',
    languages: ['en'], // gpt-transcribe takes a list of expected languages
    // Vocabulary hint for the transcription model: the words of the scenario.
    prompt: 'A sales rep thinks aloud about a sales task: a renewal email to the CFO of a hospital network (licences, scheduling platform, nurses, retention, overtime) or an idea for a supermarket chain (checkout, inventory, self checkout, fresh produce, waste, discount stores, staff representatives, finance director).',
    timeoutSeconds: 60, // long recordings of the deliberation
  },

  systemCheck: {
    testSentence: 'I would like to prepare a follow-up email for my customer.',
    maxRecordingSeconds: 15,
    retriesBeforeContact: 2, // after this many failed retries of a check, show the contact text
  },

  survey: {
    type: 'internal', // 'internal' (content/survey.<locale>.js) | 'external'
    // 'external' only. {participantId}, {round} and {taskId} are replaced.
    externalUrl: 'https://example.com/survey?pid={participantId}&round={round}&task={taskId}',
  },

  limits: {
    maxAudioUploadMB: 10,
    rateLimit: {
      windowSeconds: 60,
      transcribePerWindow: 20, // per session
      chatPerWindow: 15, // per session
      sessionStartPerWindow: 10, // per IP, limits ID guessing
    },
  },

  // Everything is written to logs/ (one file per participant, logs/<id>.jsonl), which git ignores, like
  // sessions/. Never commit either: they hold what participants said.
  logging: {
    dir: 'logs',
    storeAudio: true, // stores each uploaded recording in logs/audio/<participant>/ (test sessions)
    modelCalls: true, // logs every model call of the personalize mode in full: prompt file, input, answer
  },

  // Only used when DEV_MODE=true in .env. Ignored otherwise.
  dev: {
    participantId: 'DEV', // used by "Skip ID"; does not need to be in validIds
    mockByDefault: false, // dev sessions start with mock speech-to-text and LLM (no API cost)
    timerSpeeds: [1, 10, 60],
    mockLatencyMs: 600,
  },
};
