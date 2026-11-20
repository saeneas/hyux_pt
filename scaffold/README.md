# Scaffolding logic (personalize branch)

Everything that decides how the system thinks with the participant lives in this folder. The server
reads these files on every call, so a change takes effect at the next call without a restart.

| File | Used by | What it decides |
|---|---|---|
| `deliberation.json` | deliberation screen | the prompt conditions (open, static, adaptive), their intro text and fixed questions |
| `prompts/deliberation-adaptive.md` | adaptive condition, after each recording | the next question while the participant thinks aloud |
| `prompts/first.md` | once, when the deliberation ends | the wishes, the first question (headline) and the first pair |
| `prompts/step.md` | after every choice | the updated wishes, the next question and the next pair |
| `strategies.md` | (not used at the moment) | a catalog of writing strategies |
| `prompts/profile.md` | after the task | three to six preferences, shown on the profile screen |
| `planning-logic.svg` | (documentation) | how the next pair is decided |

Which model and reasoning effort each call uses, and the time budget, are in `config.js` under
`personal`. The code that sends these prompts is `server/routes/personal.js`; the shape of every answer
(its JSON schema) is defined there too. With `logging.modelCalls`, every call is logged in full (prompt
file, input, answer, tokens, time) in `logs/<participant>.jsonl`, which git ignores.

## The pipeline

1. **Deliberate** (about 3 minutes). The participant thinks aloud next to an empty skeleton of the text
   (an email or a document, `form` in `data/tasks.json`). The condition decides which questions they see.
2. **First pair** (`first.md`, about 6 s) and 3. **each next pair** (`step.md`, about 6 s). See
   `planning-logic.svg`. The model first applies the writer's words to the chosen version (the base:
   change, move, reorder, add, cut, anywhere; nothing declined). Plain code then picks the next question
   one step ahead: the whole text once, the structure once, the parts of the outline from top to bottom,
   the wording last; after "Neither Fits" the same question again. The model may take another part only
   when the writer's words point to it. It returns the base as labelled paragraphs and, for each
   version, only its order and the paragraphs it changes; the server builds both versions from the base,
   so everything else is exactly the same. The cards mark in bright blue where they differ and
   in a greyer blue what changed since the version chosen last (computed from the texts).
4. **Profile** (`profile.md`, one small-model call). Three to six high-level preferences, from what
   was said while thinking aloud and from the decisions, shown as topic and value.

## Testing a prompt change with real sessions

Test sessions end with a download (config `personal.offerExport`; also in the dev drawer): a file with
everything the participant said and chose, the plans, cards and profile. `scripts/replay.mjs` runs such a
file again against the running server with the current prompts and writes the new plan, pairs and
profile next to the recorded ones:

    node scripts/replay.mjs session-lisa-1a2b3c4d.json --out lisa-replay.json

The transcripts and words are replayed as spoken; the card letters only keep the rhythm, because the new
cards differ from the recorded ones.

## Orientation on the cards

`personal.display` in `config.js`, switchable per browser in the dev drawer:
- highlight `sentences`: bright blue for sentences that differ between A and B, grey blue for what
  changed since the last choice, a blue bar and "moved" for paragraphs at another place;
  `paragraphs`: differing or moved paragraphs get a blue bar, identical ones are dimmed; `off`.
- annotate `labels`: a faint heading above each paragraph (the labels of the base); `blocks`: each
  paragraph in a soft box with its heading; `off`.
