// Entry point: npm start
import express from 'express';
import path from 'node:path';
import { loadAll, ConfigError, ROOT } from './config/load.js';
import { buildClientConfig } from './config/clientConfig.js';
import { createSessionStore } from './services/sessions.js';
import { createLogger } from './logger/index.js';
import { createOpenAiService } from './services/openai.js';
import { createMockService } from './services/mock.js';
import { sessionRoutes } from './routes/session.js';
import { logRoutes } from './routes/log.js';
import { aiRoutes } from './routes/ai.js';
import { devRoutes } from './routes/dev.js';
import { chatRoutes } from './routes/chat.js';
import { intentRoutes } from './routes/intents.js';
import { compareRoutes } from './routes/compare.js';
import { personalRoutes } from './routes/personal.js';

let loaded;
try {
  loaded = await loadAll();
} catch (e) {
  console.error(e instanceof ConfigError ? `\n${e.message}\n\nThe server did not start. Fix the items above and run npm start again.\n` : e);
  process.exit(1);
}

const { env, config } = loaded;
const app = {
  ...loaded,
  store: createSessionStore({ dir: path.join(ROOT, 'sessions') }),
  logger: createLogger({ config, root: ROOT }),
  ai: createOpenAiService({ config, env }),
  mock: env.devMode ? createMockService({ config }) : null,
};
const clientConfig = buildClientConfig(app);

const server = express();
server.disable('x-powered-by');
if (process.env.TRUST_PROXY) server.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);

server.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://cdn.jsdelivr.net", // icon path data (@ui5/webcomponents-icons)
      "connect-src 'self' https://cdn.jsdelivr.net",
      "font-src 'self' https://cdn.jsdelivr.net", // 72 font
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "media-src 'self' blob:",
      "frame-ancestors 'none'",
    ].join('; '),
  });
  next();
});

server.use(express.json({ limit: '256kb' }));

// API
server.get('/api/config', (req, res) => res.json(clientConfig));
server.use('/api/session', sessionRoutes(app));
server.use('/api/log', logRoutes(app));
server.use('/api', aiRoutes(app));
server.use('/api/chat', chatRoutes(app));
server.use('/api/intents', intentRoutes(app));
server.use('/api/compare', compareRoutes(app));
server.use('/api/personal', personalRoutes(app));
if (env.devMode) server.use('/api/dev', devRoutes(app));
server.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

// Static files. The dev panel is only served in dev mode.
const noIndex = { index: false, fallthrough: true };
server.use('/design-system', express.static(path.join(ROOT, 'design-system'), noIndex));
server.use('/content', express.static(path.join(ROOT, 'content'), noIndex));
if (env.devMode) server.use('/dev', express.static(path.join(ROOT, 'dev-client'), noIndex));
server.use(express.static(path.join(ROOT, 'public')));

// eslint-disable-next-line no-unused-vars
server.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

server.listen(env.port, () => {
  console.log(`\nStudy prototype running at http://localhost:${env.port}`);
  if (env.devMode) console.log('DEV_MODE is on: dev panel, dev routes and mock mode are enabled. Do not use with participants.');
  if (!env.hasApiKey) console.log('OPENAI_API_KEY is not set: only mock mode will work.');
  console.log('');
});
