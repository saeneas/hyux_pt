# Scaffolding logic (personalize branch)

Everything that decides how the system thinks with the participant lives in this folder. The server
reads these files on every call, so a change takes effect at the next call without a restart.

| File | Used by | What it decides |
|---|---|---|
| `deliberation.json` | deliberation screen | the prompt conditions (open, static, adaptive), their intro text and fixed questions |
| `prompts/deliberation-adaptive.md` | adaptive condition, after each recording | the next question while the participant thinks aloud |
| `prompts/first.md` | once, when the deliberation ends | the wishes, the first question (headline) and the first pair |
| `prompts/step.md` | after every choice | the updated wishes, the next question and the next pair |
| `strategies.md` | profile | the catalog of writing strategies |
| `prompts/profile-evidence.md` | after the task | observations about the participant, each grounded in a quote or a measure |
| `prompts/profile.md` | after the task | the preference parameters shown on the profile screen |

Which model and reasoning effort each call uses, and the time budget, are in `config.js` under
`personal`. The code that sends these prompts is `server/routes/personal.js`; the shape of every answer
(its JSON schema) is defined there too. With `logging.modelCalls`, every call is logged in full (prompt
file, input, answer, tokens, time) in `logs/<participant>.jsonl`, which git ignores.

## The pipeline

1. **Deliberate** (about 3 minutes). The participant thinks aloud next to an empty skeleton of the text
   (an email or a document, `form` in `data/tasks.json`). The condition decides which questions they see.
2. **First pair** (`first.md`, about 6 s). One short call on a small model reads the deliberation and
   returns the writer's wishes in their own words, the broadest question their words leave open (shown
   as the headline) and two whole versions that answer it in two clearly different ways.
3. **Each next pair** (`step.md`, about 6 s). The same, from the wishes, the chosen version and the
   latest words. Nothing is planned beyond the next question, so a participant can settle several things
   at once. The cards mark in bright blue where they differ and in a greyer blue what changed since the
   version chosen last (computed from the texts).
4. **Profile**. After the task, two passes: `profile-evidence.md` gathers grounded observations,
   `profile.md` turns them into five to eight preference parameters, abstracted so they would help in
   another situation.

## Testing a prompt change with real sessions

Test sessions end with a download (config `personal.offerExport`; also in the dev drawer): a file with
everything the participant said and chose, the plans, cards and profile. `scripts/replay.mjs` runs such a
file again against the running server with the current prompts and writes the new plan, pairs and
profile next to the recorded ones:

    node scripts/replay.mjs session-lisa-1a2b3c4d.json --out lisa-replay.json

The transcripts and words are replayed as spoken; the card letters only keep the rhythm, because the new
cards differ from the recorded ones.
