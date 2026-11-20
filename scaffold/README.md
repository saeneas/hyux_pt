# Scaffolding logic (personalize branch)

Everything that decides how the system thinks with the participant lives in this folder. The server
reads these files on every call, so a change takes effect at the next call without a restart.

| File | Used by | What it decides |
|---|---|---|
| `deliberation.json` | deliberation screen | the prompt conditions (open, static, adaptive), their intro text and fixed questions |
| `prompts/deliberation-adaptive.md` | adaptive condition, after each recording | the next question while the participant thinks aloud |
| `strategies.md` | planner, profile | the catalog of writing strategies and how to scaffold each |
| `prompts/planner.md` | once, when the deliberation ends | the participant's strategy, the decisions the email needs, the stages of the path |
| `prompts/step.md` | after every pick | what the system learned, whether to stay, advance, revise or finish, and the next pair of cards |
| `prompts/profile-evidence.md` | after the task | observations about the participant, each grounded in a quote or a measure |
| `prompts/profile.md` | after the task | the strategic profile and facts shown on the profile screen |

Which model and reasoning effort each call uses, and the time budget, are in `config.js` under
`personal`. The code that sends these prompts is `server/routes/personal.js`; the shape of every answer
(its JSON schema) is defined there too.

## The pipeline

1. **Deliberate** (about 3 minutes). The participant thinks aloud next to an empty email skeleton. The
   condition decides which questions they see.
2. **Plan**. `planner.md` reads the deliberation and writes the plan: preferences already stated, the
   strategy (followed if the participant named one, inferred otherwise), the decisions the email needs
   (settled, open, blind spots and contingencies) and two to five stages with an estimate of pairs each.
3. **Compare** (7 to 8 minutes). After every pick `step.md` updates what is known, decides to stay,
   advance, revise the plan or finish, and writes the next pair: "confirm" when the system is sure
   (both cards start from what was said), "probe" when unsure (two different extremes, never the
   opposite of something ruled out), "alert" for a contingency the participant has not considered.
   The number of pairs per stage is open; the remaining time is part of every call. Each card marks
   the phrases the choice is about (`focus`, bright blue on screen) and those that carry earlier
   choices (`carried`, a greyer blue).
4. **Profile**. After the task, two passes: `profile-evidence.md` gathers grounded observations,
   `profile.md` reasons over them (with the profile of earlier tasks) and calibrates confidence.

## Testing a prompt change with real sessions

Test sessions end with a download (config `personal.offerExport`; also in the dev drawer): a file with
everything the participant said and chose, the plans, cards and profile. `scripts/replay.mjs` runs such a
file again against the running server with the current prompts and writes the new plan, pairs and
profile next to the recorded ones:

    node scripts/replay.mjs session-lisa-1a2b3c4d.json --out lisa-replay.json

The transcripts and words are replayed as spoken; the card letters only keep the rhythm, because the new
cards differ from the recorded ones.
