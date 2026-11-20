// Screen registry. Each entry lazy-loads a module whose default export is a factory:
//   export default function create() { return { mount(container, ctx), unmount() } }
// To add a screen: create the module, register it here, add its name to flow.* in config.js,
// and add it to SCREENS in server/config/validate.js.
const registry = {
  welcome: () => import('./welcome.js'),
  systemCheck: () => import('./systemCheck.js'),
  tutorial: () => import('./tutorial.js'),
  briefing: () => import('./briefing.js'),
  deliberate: () => import('./deliberate.js'),
  task: () => import('./task.js'),
  survey: () => import('./survey.js'),
  profile: () => import('./profile.js'),
  interview: () => import('./interview.js'),
  end: () => import('./end.js'),
};

export async function loadScreen(name) {
  const load = registry[name];
  if (!load) throw new Error(`Unknown screen: ${name}`);
  return (await load()).default;
}
