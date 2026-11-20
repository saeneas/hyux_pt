// Personal interaction mode (personalize): the comparisons are planned from the participant's
// deliberation and guided by the plan (server/routes/personal.js, scaffold/). See canvas.js.
// A mode module provides: name, createCanvas(ctx, options) and tutorialSteps (none here: the tutorial screen skips itself).
export const name = 'personal';
export { createCanvas } from './canvas.js';

