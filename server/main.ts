/*
 * Production server: `npm start` after `npm run build`. One Node process: the
 * API and live room (server/api.ts) in front of Astro's pages and files.
 * Plain http on 127.0.0.1 by default, with Caddy in front for HTTPS
 * (deploy/Caddyfile). `--https` serves a self-signed certificate instead, for
 * testing on the local network without Caddy (`npm run preview`).
 */
import { createServer as createHttp, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApi } from './api.ts';
import { loadConfig } from './config.ts';
import { createContext } from './context.ts';
import { ensureSetupToken, setupLink } from './setup-token.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const config = loadConfig({ ...process.env, ...(opt('port') ? { PORT: opt('port') } : {}), ...(opt('host') ? { HOST: opt('host') } : {}) });
const ctx = createContext(config);
const api = createApi(ctx);

// No account yet: making the admin account needs the one-time setup link.
if (!ctx.db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const token = ensureSetupToken(config.data);
  console.log(`No account yet. Create the admin account at ${setupLink(config.origin, token)}`);
}

// Astro's built handler (pages and static files), started by us rather than by itself.
process.env.ASTRO_NODE_AUTOSTART = 'disabled';
const entry = pathToFileURL(join(process.cwd(), 'dist', 'server', 'entry.mjs')).href;
const { handler: astro } = (await import(entry)) as { handler: (req: IncomingMessage, res: ServerResponse) => void };

const listener = (req: IncomingMessage, res: ServerResponse) => api.handle(req, res, () => astro(req, res));

let server;
if (flag('https')) {
  const { getCertificate } = await import('@vitejs/plugin-basic-ssl');
  const pem = await getCertificate(join(config.data, 'cert'), 'podstudio', ['localhost', '127.0.0.1', '::1']);
  server = createHttps({ key: pem, cert: pem }, listener);
} else {
  server = createHttp(listener);
}
// Match the media client timeout so slow, streamed uploads can finish.
server.requestTimeout = 15 * 60 * 1000;
api.attach(server);
server.listen(config.port, config.host, () => {
  console.log(`Podstudio on ${flag('https') ? 'https' : 'http'}://${config.host}:${config.port} · data in ${config.data}`);
});

// Stop cleanly on systemd's SIGTERM: finish requests, close the database.
const stop = () => {
  server.close(() => {
    ctx.db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
