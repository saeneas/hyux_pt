# Sales Workbench study prototype

This is a research prototype for a voice-driven AI task study. Participants are sales professionals. They give spoken instructions to an AI assistant and use it to complete realistic sales writing tasks. The assistant replies in text. The study then guides them through a questionnaire after each task.

- The stack is Node and Express with vanilla ES modules in the browser. There is no build step.
- Speech-to-text and the LLM run through the OpenAI API, called **only from the server**.
- The UI uses the Fiori Horizon design system (`design-system/`) in light mode with compact density.

---

## This branch: personalize

Built on `compare`. Metacognitive scaffolding, voice and personalization in one flow of about 11 minutes:

1. **Welcome:** the participant picks their name (`participants.pickList`).
2. **Briefing:** the task and the time.
3. **Think It Through** (`screens/deliberate.js`, about 3 minutes): the participant thinks aloud next to an empty email skeleton. The condition (open, static or adaptive prompts, `scaffold/deliberation.json`) is set per session in the dev drawer.
4. **Task** (`modes/personal`, 8 minutes): two whole versions at a time under a headline of a few words (the aspect, e.g. "Tone"), with highlights of where they differ and of what changed since the last choice. The participant chooses one (or Neither Fits), says why, and continues; each next pair takes about 6 s. The task time starts when the first pair is on screen.
5. **Questionnaire**, then **Your Preferences** (`screens/profile.js`): five to eight preference parameters the system inferred, as name and value.

Two tasks: the hospital renewal email and the supermarket idea (`data/tasks.json`; `form` decides whether the skeleton looks like an email or a document, `deliverable` tells the model what to write).

All prompts and the strategy catalog are in [`scaffold/`](scaffold/README.md) and are read on every call. Models and effort per call are in `config.js` under `personal`; the server code is `server/routes/personal.js`.

**Dev drawer** (tab at the right edge, `DEV_MODE=true`): start a session as one of the participants with a condition, jump to any step, end the thinking time, reset the task, download the session file, and look at the brief, the aspects, every pair and the profile while they are made.

**Logs** stay out of git: `logs/<participant>.jsonl` holds every event and, with `logging.modelCalls`, every model call in full; `logging.storeAudio` keeps the recordings in `logs/audio/`; sessions are in `sessions/`.

**Session files:** with `personal.offerExport` the end screen offers a download of the session. `node scripts/replay.mjs <file>` replays it against changed prompts.

There is no mock mode on this branch: every call uses the real models, so `.env` needs `OPENAI_API_KEY`.

## Contents

1. [Setup](#setup)
2. [How the study runs](#how-the-study-runs)
3. [Configuration reference](#configuration-reference) (every option in `config.js` and `.env`)
4. [Adding or changing a task](#adding-or-changing-a-task)
5. [Text, questionnaire and language](#text-questionnaire-and-language)
6. [Adding an interaction mode](#adding-an-interaction-mode)
7. [Dev mode](#dev-mode)
8. [Logging](#logging)
9. [Security and privacy](#security-and-privacy)
10. [Running a study session](#running-a-study-session)
11. [Project structure](#project-structure)

---

## Setup

You need Node.js 20.12 or later. The project was built on Node 26.

```bash
npm install
```

```bash
cp .env.example .env
```

Open `.env`, then set `OPENAI_API_KEY`. Set `DEV_MODE=true` while you build or test (see [Dev mode](#dev-mode)).

```bash
npm start
```

Open http://localhost:3000 (or the `PORT` you set).

The server checks `config.js` and `data/tasks.json` at startup. If anything is wrong, it lists every problem and does not start. To run the same check without starting the server:

```bash
npm run check:config
```

Other scripts:

| Script | What it does |
|---|---|
| `npm run dev` | Starts the server and restarts it when server files change. Browser files never need a restart, only a page reload. |
| `npm run build:tokens` | Regenerates `design-system/tokens.css` from `design-system/tokens.json`. Run it only after you replace the design-system export. |

Changes to `config.js`, `data/tasks.json` or `.env` need a server restart. Changes to `content/` and `public/` need only a page reload.

---

## How the study runs

The screen order comes from `flow` in `config.js`:

```
pre:   welcome → systemCheck → tutorial
round: briefing → task → survey → interview      (repeated flow.rounds times)
post:  end
```

| Screen | What happens |
|---|---|
| **welcome** | The participant enters their ID, and the server checks it. A small or unsupported browser gets a notice here. |
| **systemCheck** | Microphone permission, then a level meter. The participant reads the test sentence aloud, the recording is transcribed, and one short LLM call is made. Each check can be retried. After `retriesBeforeContact` failed retries, a contact text appears. |
| **tutorial** | A guided tour over a sample canvas that highlights one area at a time. Then, if `tutorial.practiceTurn` is on, one real instruction is sent to the assistant. |
| **briefing** | A dialog over the canvas shows the full scenario (situation and task) and the recommended time limit, so reading does not count toward task time. The task text behind it is hidden. **Start Task** starts the timer. |
| **task** | The main canvas of the session's [interaction mode](#interaction-modes). The task panel shows the title and the task; the situation (and any materials) is shown next to it and can be collapsed with **Hide Situation**. Only the assistant's latest response is shown (each new one replaces it), with how long ago it was updated. Earlier responses stay stored and logged. The participant keeps going until they select **Finish Task** or time runs out. |
| **survey** | The questionnaire about the task, either built in or a link to an external tool. |
| **interview** | "Conversation Review": a read-only view of the task and every turn with timestamps, to look at together with the interviewer. Off by default. |
| **end** | Marks the session complete and shows the completion code, if one is set. |

**Reloading** the page resumes exactly where the participant was:

- the current step
- the time limit, which counts from the stored start time
- the instruction draft
- a response that was still being written
- answers already given in the questionnaire

The session lives on the server (`sessions/`). The browser only keeps the session ID in `localStorage`. If a participant enters their ID again in another browser, the same session continues there (when `allowReuse` is false).

### Interaction modes

Each session has one interaction mode, set from `interaction.mode` in `config.js` when the session starts (stored with the session, so changing the config later does not affect sessions in progress). In dev mode the dev panel can switch the current session.

**`voice`.** The participant records one or more recordings; their transcripts form the instruction ("Current Instruction", which can be cleared but not typed into). **Send Instruction** sends it. The model gets the earlier turns of the task as history (`ai.sendHistory`).

**`intents`.** The participant thinks aloud, and what they say becomes intents: short change requests for the draft.

1. **Starting draft.** Every task starts from the same generic starting draft, the task's `scaffold` in `data/tasks.json`: a plain, neutral version of the deliverable (placeholders in square brackets where needed), without any personal flavour or strategic choice. It is shown as **Starting Draft** (no AI call; the server stores it as turn 1 with `kind: 'scaffold'`), and the first AI response is Version 1. The practice round's starting draft is `tutorial.practice.intents.task.scaffold` in the strings file. A task without a `scaffold` starts as in the voice mode instead: recordings build the first instruction, **Send Instruction** sends it as spoken, and the response is the first draft.
2. **Intent cards.** From then on, each recording is transcribed and the LLM splits it into one or more intents (`ai.intents.extractPrompt`, with the latest draft as context). Each intent has the request (`text`), the participant's reason for it (`reason`, only what they said, empty if they gave none) and their own words (`quote`). It becomes a compact card next to the draft, newest first: a checkbox (on/off), the request, the reason under **Why**, the own words folded under **Your words**, a state (**New** = not sent yet, **Changed** = changed by voice since it was last sent, **In Version n** = last sent in an older version) and a microphone (**Hold to Change**) that shows on hover or focus. Holding it records an annotation; on release it is transcribed and the LLM rewrites the intent and its reason (`ai.intents.annotatePrompt`). Intents that are in the latest version and unchanged since move to a collapsed **In the draft (n)** group at the bottom, so new thinking stays in view. Switching a card on or off never moves it; changing an intent in the group by voice moves it back up.
3. **Send** hands the model only the intents that are on, each with its reason (`- text (why: reason)`), plus the latest draft (`ai.intents.reviseInstruction`), not the history. The button counts what it sends, for example **Send 2 New + 4 Kept** (new or changed intents, and intents already in the draft). The response is the next version. The cards stay, so intents that stay on are sent again with every version; new recordings add new cards.

Only one recording runs at a time. While the assistant writes, the cards are locked. The task end waits for running transcriptions, intent extractions and changes. Intents are stored with the session (`rounds[round].intents`) and survive a reload.

**`compare`** (branch `compare`). The participant never instructs the AI: they choose. Two similar versions stand side by side between the task (top) and the timer (bottom). No tutorial yet (the tutorial screen skips itself for a mode without `tutorialSteps`).

1. **First pair.** `POST /api/compare/start` writes two versions from the outline (`scaffold`) and the situation (if `ai.compare.includeSituation`) that are alike except for two or three writing choices (`ai.compare.initialPrompt`).
2. **Pick and say why.** The participant picks a version (**Pick This One**; they can switch), then holds the microphone in that card and says what they like most about it. **Show differences** highlights the words that differ between the two.
3. **Next.** **Keep It, Show a New One** (`POST /api/compare/next`, `ai.compare.nextPrompt`) updates a hidden preference profile from the pick, the rejected version and what was said, and writes a new version from the pick: it keeps what the profile settles and varies one or two aspects it does not settle yet, more subtly as the profile grows. The kept version stays on its side, marked *Your last pick*; the other leaves and the new one (*New*) takes its place.
4. **Accept.** **Accept as Final** marks the picked version as the result (`POST /api/compare/accept`) and asks to finish the task.

The profile is never sent to the browser. Everything is stored with the session (`rounds[round].compare`: versions with their differences, the pair, the profile, every pick with the annotation and the profile before and after, the accepted version).

---

## Configuration reference

### `.env` (secrets and environment, never committed)

| Variable | Default | Meaning |
|---|---|---|
| `OPENAI_API_KEY` | — | Required unless every call is mocked in dev mode. It stays on the server. |
| `PORT` | `3000` | HTTP port. |
| `DEV_MODE` | `false` | `true` turns on the dev panel, the dev routes and mock mode. **Must be off for participants.** It cannot be turned on from the URL or the browser. |
| `TRUST_PROXY` | unset | Set it to `true` behind an HTTPS reverse proxy, so that rate limiting sees the real client IPs. |

### `config.js`

Each section of `config.js` is documented below. Every option is checked at startup.

#### `study`
| Option | Example | Meaning |
|---|---|---|
| `id` | `'hyux-formative-01'` | Identifies the study run. |
| `productName` | `'Sales Workbench'` | Plain text shown in the shell bar and as the page title. Don't use logos or SAP product names. |
| `locale` | `'en'` | Loads `content/strings.<locale>.js` and `content/survey.<locale>.js`, and sets the page language. |
| `completionCode` | `''` | Shown on the end screen if it is not empty, for example a panel provider's code. It reaches the browser only on the end screen. |

#### `participants`
| Option | Meaning |
|---|---|
| `validIds` | List of valid participant IDs. Matching ignores case and surrounding spaces. **This list is never sent to the browser.** |
| `allowReuse` | `false`: one session per ID. Entering the ID again resumes that session. After the session is completed, the ID is rejected. `true`: every entry starts a new session. |

#### `flow`
| Option | Meaning |
|---|---|
| `pre`, `round`, `post` | Screen order before, during (×N) and after the rounds. Screen names are the modules in `public/js/screens/index.js`. |
| `enabled` | `{ tutorial, survey, interview }`. A screen set to `false` is skipped everywhere. |
| `rounds` | Number of tasks per participant (N). It must not exceed the number of tasks available to a participant. |
| `taskSelection.mode` | `'fixed'` uses `order` as is. `'random'` shuffles `order` once per participant (and keeps it across reloads). `'perParticipant'` uses the participant's list in `perParticipant`. |
| `taskSelection.order` | Task IDs from `data/tasks.json`. |
| `taskSelection.perParticipant` | `{ P01: ['task-02', 'task-01', 'task-03'], … }`. IDs that aren't listed fall back to `order`. Every ID must be in `validIds`, and every task ID must exist. |

The tasks for a session are assigned when it starts and stored with it. Changing the selection later doesn't affect running sessions.

#### `interaction`
| Option | Meaning |
|---|---|
| `mode` | Default interaction mode for new sessions (currently `'compare'` on this branch): a folder in `public/js/modes/` (`'voice'`, `'intents'` or `'compare'`, see [Interaction modes](#interaction-modes)). The dev panel can switch the current session. |
| `recordingMode` | `'pushToTalk'`: hold the button or the Space key. Space works only when focus isn't in a text field. `'toggle'`: select once to start and again to stop. The tutorial text follows this setting. |
| `maxRecordingSeconds` | A recording stops automatically after this long and is transcribed. |

#### `tutorial`
| Option | Meaning |
|---|---|
| `practiceTurn` | `true`: the tutorial ends with one real recording sent to the AI. It uses real API calls unless mock mode is on. |

#### `timer`
| Option | Meaning |
|---|---|
| `mode` | `'hard'`: at the limit, a notice shows for `endNoticeSeconds`, then the task ends. `'soft'`: at the limit, a notice shows and the bar turns red, but the task goes on until the participant ends it. `'grace'`: at the limit, `graceMinutes` of extra time start. When they run out, the task ends like in `'hard'`. |
| `graceMinutes` | Extra time in `'grace'` mode. |
| `warningSecondsBeforeLimit` | The bar turns orange and a notice appears this many seconds before the limit (`0` = no warning). |
| `endNoticeSeconds` | How long the "time is up" notice shows before the study moves on. |

Participants see time only as a progress bar under the controls, with no countdown in numbers. The briefing shows the limit as the "Recommended Time Limit". The time limit per task is `timeLimitMinutes` in `data/tasks.json`. If the limit is reached during a recording, the recording stops and is transcribed, and the transcript is logged. If it is reached while the assistant is writing, the response is finished and shown before the task ends.

#### `ai`
| Option | Meaning |
|---|---|
| `assistantName` | Name shown for the assistant. Use a job-based name, not a human name. |
| `model` | OpenAI model, called through the Responses API. |
| `systemPrompt` | Instructions for the model. **The model never sees the task or the situation.** It sees only this prompt, the earlier turns (if `sendHistory`) and the new instruction; in the intents mode, the starting draft (`scaffold`) as the first current draft. It asks for the text only, without introduction or comments. As a safety net, `public/js/core/cleanResponse.js` removes a remaining introduction ("Here is the revised version:", "Shortened to five sentences:") or closing comment ("Let me know if you'd like other changes to the draft.") from every response, both while it streams and before it is stored. The removed parts are kept in `rawResponse` and logged. |
| `temperature` | `null` = not sent. Some models (for example `gpt-6.2-sol`) don't accept it. |
| `reasoningEffort` | `null` = not sent. Otherwise `'low'`, `'medium'`, `'high'`, `'xhigh'` or `'max'`. Lower effort gives faster responses. |
| `maxOutputTokens` | Upper limit for one response. |
| `sendHistory` | `true`: the earlier turns of the current task are sent with each instruction. |
| `timeoutSeconds` | A response that takes longer fails with a retry option. Also the time limit for the AI check in the system check and for intent calls. Responses always stream: they appear while they are being written. |
| `intents.extractPrompt` | Intents mode: instructions for splitting a spoken comment into intents. The call returns JSON (`{ intents: [{ text, reason, quote }] }`) and gets the latest draft as context. |
| `intents.annotatePrompt` | Intents mode: instructions for rewriting one intent from a spoken annotation. Gets the intent and its reason; returns JSON (`{ text, reason }`). |
| `intents.reviseInstruction` | Intents mode: put before the active intents (with their reasons) and the latest draft when **Send** is selected. The draft is written with `systemPrompt` as usual. |
| `intents.maxOutputTokens` | Upper limit for the intent calls. |
| `compare.initialPrompt` | Compare mode: instructions for the first pair. Returns JSON (`{ a, b, differences }`). |
| `compare.nextPrompt` | Compare mode: instructions for updating the hidden profile and writing the next version. Gets the profile, the picked and the rejected version, the annotation and the round; returns JSON (`{ profile, challenger, differences }`). |
| `compare.includeSituation` | Compare mode: `true` gives the model the task's situation (facts), since the participant gives it none. The task itself is never sent. |
| `compare.maxOutputTokens` | Compare mode: upper limit for its calls (the first one writes two full versions). |
| `intents.hedgeAfterSeconds` | If an intent call (extract or change) has not answered after this many seconds, a second, identical request starts and the first answer is used. Intent calls usually take 2–3 s; this cuts the rare request that takes 20 s or more. `0` = off. The log shows `attempts` (requests started) and `attempt` (which one answered). |

#### `stt` (speech-to-text)
| Option | Meaning |
|---|---|
| `model` | OpenAI transcription model. |
| `languages` | Expected languages, for example `['en']` or `['en', 'de']`. |
| `prompt` | Optional vocabulary hint, such as product or customer names. |
| `timeoutSeconds` | Server-side timeout for one transcription, in the tasks and in the system check. |

#### `systemCheck`
| Option | Meaning |
|---|---|
| `testSentence` | The sentence participants read aloud. |
| `maxRecordingSeconds` | Recording limit for the test. |
| `retriesBeforeContact` | After this many failed retries, the screen shows the contact text from the strings file. |

#### `survey`
| Option | Meaning |
|---|---|
| `type` | `'internal'` shows `content/survey.<locale>.js`, and the answers go to the log. `'external'` shows an **Open Questionnaire** link and an **I Have Finished the Questionnaire** button. |
| `externalUrl` | `'external'` only. `{participantId}`, `{round}` and `{taskId}` are filled in. |

#### `limits`
| Option | Meaning |
|---|---|
| `maxAudioUploadMB` | Larger uploads are rejected (413). |
| `rateLimit.windowSeconds` | Window for the limits below. |
| `rateLimit.transcribePerWindow` | Transcriptions per session per window. |
| `rateLimit.chatPerWindow` | AI requests (and system-check calls) per session per window. |
| `rateLimit.sessionStartPerWindow` | ID entries per IP per window. This limits guessing. |

#### `logging`
| Option | Meaning |
|---|---|
| `dir` | Folder for the log files (`logs/`, gitignored). |
| `storeAudio` | `false` (default): recordings are transcribed and discarded. `true`: each recording is also saved to `logs/audio/<participantId>/`, and the `server.transcribe` event names the file. Only turn this on if the consent covers it. |

#### `dev` (used only when `DEV_MODE=true`)
| Option | Meaning |
|---|---|
| `participantId` | ID used by **Skip ID**. It doesn't need to be in `validIds`. |
| `mockByDefault` | Dev sessions start with mock speech-to-text and a mock LLM (no API cost). |
| `timerSpeeds` | Speed choices in the dev panel. |
| `mockLatencyMs` | Simulated delay of mock calls. |

---

## Adding or changing a task

Tasks are in `data/tasks.json`:

```json
{
  "id": "task-04",
  "title": "Follow up after a trade fair",
  "situation": "Background the participant needs: who, what happened, what they know.",
  "task": "The instruction: what the participant should get the assistant to produce.",
  "briefing": "Short text shown before the task starts (may be empty).",
  "scaffold": "Generic starting draft for the intents mode: an outline with [placeholders], no choices made.",
  "timeLimitMinutes": 6,
  "materials": [
    { "title": "Booth Notes", "body": "Text. Line breaks are kept." }
  ]
}
```

- `id`, `title`, `situation`, `task` and `timeLimitMinutes` are required. `briefing` may be an empty string. `materials` and `scaffold` are optional. `scaffold` is only used by the intents mode, and it is the one part of the task the model sees (as the first current draft).
- The briefing shows `situation` and `task` in full. During the task the situation and any materials are shown next to the task; **Hide Situation** collapses them.
- Use a blank line (`\n\n`) in `situation` to separate paragraphs. Line breaks are kept.
- The layout is checked for a situation of about 120 words and a task of about 40 words, at 1024×768 and larger. Much longer texts still work but scroll.
- `placeholderFields` (optional) is only a note for authors. It marks fields that still hold generated placeholder text.
- To use the new task, add its ID to `flow.taskSelection.order` (or to `perParticipant` lists) and, if needed, raise `flow.rounds`. Then restart and run `npm run check:config`.

The browser receives only the tasks assigned to the current session.

---

## Text, questionnaire and language

- **All UI text** is in `content/strings.en.js`, grouped by screen. Follow the design-system writing rules:
  - Title Case for buttons and titles, and buttons start with a verb.
  - Plain, neutral sentences, without emoji or exclamation marks.
  - The working state describes what is happening (never "Thinking…").
- **The questionnaire** is in `content/survey.en.js`. Each question has an `id`, which becomes the key in the logged answers, a `text`, and `required`. The types are:
  - `scale`: needs `min`, `max`, and optionally `minLabel` and `maxLabel`. Shown as one button per value.
  - `choice`: needs `options`. Single choice.
  - `text`: free text, up to 2000 characters.
- **Another language:** copy both files with the new locale code (for example `strings.de.js` and `survey.de.js`), translate them, set `study.locale`, and add the language to `stt.languages`. Placeholders such as `{round}` must stay unchanged.

---

## Adding an interaction mode

The core is independent of how participants give instructions. The core consists of:

- the flow controller
- the timer
- the logger
- the AI client
- the session state
- the screens

A mode is a folder `public/js/modes/<name>/` whose `index.js` exports:

```js
export const name = 'typed';
export function createCanvas(ctx, options) { … }          // the task UI
export function tutorialSteps({ recordingMode }) { … }    // the tutorial tour
```

**`createCanvas(ctx, { round, task, live, conceal, sample, showFinish, onTurn })`** builds the task UI and returns:

| Member | Used by | Purpose |
|---|---|---|
| `el` | all | Root element; the screen inserts it. |
| `timerSlot` | task | Element where the task screen puts the timer bar. |
| `noticeSlot` | task, tutorial | Element for notices (time warnings, practice banner). |
| `getRegion(name)` | tutorial | Returns the element for a tour step (`task`, `record`, `transcript`, `send`, `output`, `timer`, `finish` in the voice mode; the intents mode adds `intents` and `intentCard`). |
| `onFinishRequest` | task | Set by the task screen; call it when the participant selects Finish Task. |
| `isBusy()` | task | True while a recording, transcription or AI response is running. |
| `setLocked(bool)` | task | Turns input off (for example at the time limit). |
| `stopRecording(reason)` | task | Stops a running recording (the time limit uses this). |
| `whenIdle()` | task | Promise that resolves when nothing is running any more. |
| `destroy()` | all | Releases listeners and timers. |

Options:
- `live: false` renders the same layout without input. The briefing backdrop and the tutorial use it.
- `conceal` hides the task text.
- `sample` provides `{ turns, draft, intents }` for the tutorial (`tutorial.sample` in the strings file; a mode uses what it needs).
- `onTurn(turn)` is called after each finished AI response.

**Build the canvas on `core/conversation.js`.** It holds everything about talking to the assistant that doesn't depend on the input:
- sending an instruction and streaming the response
- the list of finished turns and the one being answered
- picking up a response that was still being written before a reload
- logging (`ai.sent`, `ai.received`, `ai.failed`)
- busy and idle: `isBusy()` and `whenIdle()` can be passed straight through to the canvas API

A mode then only adds its input and its layout. It marks its own work with `conv.setBusy(key, on)`, so the task end waits for it; the voice mode does this for transcription. `conv.send(text, logPayload, body)` can pass extra fields to `/api/chat` (the intents mode sends `{ intentIds }`).

**Shared canvas parts** in `public/js/core/canvas/`, used by both modes:
- `taskPanel.js`: the task panel with Hide/Show Situation (open by default).
- `latestResponse.js`: the latest response with "Version n" and "Updated … ago".
- `controls.js`: the bar with record button, level meter, send, finish and the timer slot.
- `voiceInput.js`: one record button from recording to transcript (`onText`), with logging and busy marking. A mode can have several (the intents mode has one per card, with `keyboard: 'focus'` so Space only works on the focused button).

See `public/js/modes/voice/canvas.js` (the smallest) and `public/js/modes/intents/canvas.js` for how they fit together. Use `logEvent` for the mode's own events. That way the server routes, logging and mock mode work unchanged.

**`tutorialSteps()`** returns `[{ region, titleKey, textKey }]`. Each region is the name passed to `getRegion`. The keys point to text in the strings file.

Set `interaction.mode: '<name>'` in `config.js`. The server checks that the folder exists, and the dev panel lists every folder.

Recording itself sits behind the `Recorder` interface (`public/js/core/recorder/`) with `pushToTalk` and `toggle` implementations. A new way of recording is a new subclass, registered in `recorder/index.js`.

---

## Dev mode

Dev mode is on only with `DEV_MODE=true` in `.env`. When it is off, the dev panel file and the `/api/dev` routes are not served at all (404).

The **Dev Mode** panel at the top right (it can be collapsed) offers:

- **Session:** shows the current participant, session and tasks.
  - **Skip ID** starts a dev session (participant `dev.participantId`).
  - **Skip System Check** and **Skip Tutorial** jump past those screens.
  - **New Session** forgets the session in this browser.
- **Interaction mode:** switches the current session to another mode and shows the current step again in it. The default for new sessions is `interaction.mode` in `config.js`. Logged as `session.modeChanged`.
- **Mock mode:** switches for Speech-to-text and the LLM.
  - Mock transcription returns the test sentence in the system check and canned instructions elsewhere.
  - The mock LLM returns canned drafts. For intents it splits the comment at sentences and "and", and appends an annotation to the intent: enough to click through, not a real rewrite.
  - Neither costs anything. Dev sessions start mocked when `dev.mockByDefault` is true.
- **Jump to step:** go to any step of the flow.
- **Timer speed:** 1×, 10× or 60×, to test time limits quickly. The choice is remembered in this browser.
- **Session state:** the stored browser state.
- **Logged events:** live list of events as they are logged.

To test the end of a task quickly, set a task's `timeLimitMinutes` to `1` or use 60× speed.

---

## Logging

`logEvent(type, payload)` in the browser buffers events and sends them in batches to `POST /api/log`. They are also sent when the tab is hidden or closed. The server writes them through the logger interface (`server/logger/index.js`).

Storage today is one JSON-lines file per participant: `logs/<participantId>.jsonl`. Failed ID entries go to `logs/invalid-attempts.jsonl` (only the length of what was typed). To store events elsewhere (a database or a service), replace the implementation in `server/logger/` and keep `write(event)`. No route or screen changes.

Every event has the same fields:

```json
{
  "ts": "2026-11-18T12:17:30.202Z",
  "clientTs": "2026-11-18T12:17:29.196Z",
  "participantId": "P07",
  "sessionId": "7c3e1bc8-…",
  "round": 1,
  "taskId": "task-01",
  "msSinceTaskStart": 44073,
  "type": "ai.received",
  "payload": { }
}
```

The fields mean:
- `ts`: server time.
- `clientTs`: browser time, or `null` for server events.
- `round`: 1..N for tasks, 0 for the tutorial practice turn, `null` outside a round.
- `msSinceTaskStart`: counts from **Start Task**.
- **Participant and session always come from the server-side session, never from the browser.**
- For server events, `msSinceTaskStart` is server time minus the task start the browser saved. A clock difference between the participant's computer and the server shifts it by that amount. Use `clientTs` with browser events for exact ordering within a session.

Events (`server.*` and `session.*` come from the server; all others come from the browser):

| Area | Events |
|---|---|
| Session | `session.started` (with `mode`), `session.resumed`, `session.completed`, `session.invalidId`, `session.client` (browser, viewport), `session.modeChanged` (dev panel) |
| Steps | `step.entered`, `step.left` (with reason), `step.error` |
| System check | `systemCheck.check` (each check and its result), `systemCheck.passed`, `recording.*` with `context: 'systemCheck'` |
| Tutorial | `tutorial.started`, `tutorial.step`, `tutorial.tourCompleted`, `tutorial.practiceStarted`, `tutorial.practiceTurn`, `tutorial.completed` |
| Task | `task.started` (with `mode`), `taskPanel.opened`, `taskPanel.closed` (the task panel starts collapsed to its title), `task.finishRequested`, `task.finishCancelled`, `task.finished` (reason, elapsed time, turns) |
| Timer | `timer.warning`, `timer.limit`, `timer.graceEnd` |
| Recording | `recording.start`, `recording.stop` (duration, reason, size, format, peak level), `recording.error`. Intents mode: `target: 'instruction'` (first instruction), `'intents'` (new intents) or `'intent'` with `intentId` (a card's annotation); the same fields are on `transcript.*`. |
| Transcription | `transcript.received` (length, latency), `transcript.empty`, `transcript.failed`, `draft.cleared` (the discarded text), `server.transcribe` (text, latency, size, format, audio file if stored) |
| Intents | `scaffold.shown` (chars), `scaffold.failed`, `server.scaffold.shown` (**starting draft text**), `intents.extracted` (count, IDs, latency), `intents.extractFailed`, `intent.toggled` (ID, on/off, number on, state), `intent.toggleFailed`, `intent.quoteToggled` (ID, open), `intents.keptToggled` (open, count), `intent.annotated` (ID, latency), `intent.annotateFailed`, `server.intents.extracted` (**transcript, intent texts, reasons and quotes**), `server.intent.annotated` (**annotation, intent and reason before and after**) |
| Compare | `compare.shown` (pair, resumed), `compare.picked` (version, side, round, switched, whether it was the kept one), `compare.noted`, `compare.noteCleared`, `compare.noteDiscarded`, `compare.next`, `compare.newVersion` (latency), `compare.nextFailed`, `compare.startFailed`, `compare.accepted`, `compare.diffToggled`, `server.compare.initial` (**both texts, differences**), `server.compare.next` (**pick, annotation, profile before and after, new text, differences**), `server.compare.accepted` (**final text, profile**). Recordings carry `target: 'compare'`. |
| AI | `ai.sent` (length; intents mode: `step: 'first'` or `'intents'` with the intent IDs sent and the number switched off), `ai.received` (latency, first token; `resumed: true` if the response finished during a reload), `ai.failed`, `server.ai.request` (instruction, model, history length; intents mode: the intents sent, with their reasons), `server.ai.response` (**response text**, latency, token usage; `cleaned: true` and **`rawText`** when an introduction or closing comment of the model was removed) |
| Questionnaire | `survey.submitted` (answers), `survey.externalOpened`, `survey.externalDone` |
| End | `study.completed` |
| Problems | `client.error` (uncaught errors, failed saves), `client.saveRecovered`, `client.smallScreen`, `server.error` (route, error code, detail) |

Texts (transcripts, instructions, responses) are logged once, in the `server.*` events; the browser events carry lengths and timings. The complete conversation of each round is also stored with the session in `sessions/<sessionId>.json` (`rounds[round].turns`). It includes the instruction, response, times, latency and token usage. In the intents mode, `rounds[round].intents` holds every intent with its reason, quote, source transcript, annotations (before/after, with reasons), on/off state and the versions it was sent in.

---

## Security and privacy

- The OpenAI key is read from `.env` on the server. The browser never calls OpenAI, and the key never appears in any response.
- Participant IDs are checked on the server. The browser receives neither the list nor the system prompt, only a safe part of the config (`server/config/clientConfig.js`).
- Every API call after the ID entry needs the session ID that the server issued.
- Limits:
  - audio size (`maxAudioUploadMB`), with only audio formats accepted
  - recording length
  - instruction length (4000 characters)
  - request body size (256 KB)
  - rate limits per session and per IP
- Security headers include a Content Security Policy. Scripts load only from this server. Icons and the 72 font load from jsDelivr.
- Audio isn't stored by default (`logging.storeAudio: false`).
- `logs/`, `sessions/`, `.env` (and any `.env.*` except `.env.example`) and all `*.jsonl` files are gitignored. Treat `logs/` and `sessions/` as research data: they contain everything participants said to the assistant.
- A pre-commit check in `.githooks/pre-commit` blocks these files even when they are added with `git add -f`, and blocks any change that contains something that looks like an OpenAI key (`sk-…`). `npm install` turns it on for the clone (the `prepare` script sets `core.hooksPath`). If you clone without running `npm install`, run `git config core.hooksPath .githooks` once.

---

## Running a study session

Before a session:
1. Set `DEV_MODE=false` in `.env`, and check `validIds`, `rounds`, `taskSelection`, `timer` and `survey` in `config.js`.
2. Run `npm run check:config`, then `npm start`.
3. Go through the study once with a spare ID, using real calls. Then delete that ID's files in `logs/` and `sessions/`, or keep a spare ID only for this.
4. Use the latest Chrome or Edge on a laptop or desktop with a working microphone. Firefox and Safari also work.

To deploy on a server, run it behind HTTPS, because browsers allow the microphone only on HTTPS or localhost. Set `TRUST_PROXY=true` there. `logs/` and `sessions/` must be on persistent storage.

To start over with an ID, delete that participant's session file in `sessions/`. The `participantId` is inside the file. You can also set `allowReuse: true` for the test.

---

## Project structure

```
config.js                 study configuration (single source of truth)
data/tasks.json           tasks
content/                  all UI text and the questionnaire, per locale
design-system/            Fiori Horizon export (don't edit; tokens.css is generated)
server/
  index.js                Express app, security headers, static files
  config/                 load + validate config, client-safe subset
  routes/                 session, transcribe/health, chat (streaming), intents, compare, log, dev
  services/               OpenAI calls, mocks, session store, task assignment
  middleware/             session check, rate limiting
  logger/                 logger interface + JSONL implementation
public/
  index.html, css/app.css shell and prototype styles (only reads --sap… variables)
  js/main.js              bootstrap
  js/core/                flow controller, session, API client, conversation, logEvent, timer, recorder, dialogs, coach marks
  js/core/canvas/         canvas parts shared by the modes: task panel, latest response, controls, voice input
  js/screens/             one module per screen: { mount(container, ctx), unmount() }
  js/modes/voice/         voice interaction mode: canvas + tutorial steps
  js/modes/intents/       intents interaction mode: canvas + tutorial steps
  js/modes/compare/       compare interaction mode: canvas (two versions) and word diff
dev-client/devPanel.js    dev panel (served only in dev mode)
scripts/build-tokens.mjs  generates design-system/tokens.css
```
