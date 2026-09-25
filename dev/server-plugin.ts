/*
 * `npm run dev`: the real Podstudio API (server/api.ts) inside Vite's dev
 * server, next to the app, with its data in .podstudio-dev/. Production runs
 * the same handler from server/main.ts.
 */
import type { Server } from 'node:http';
import type { Plugin } from 'vite';
import { createApi, type Api } from '../server/api.ts';
import { loadConfig } from '../server/config.ts';
import { createContext } from '../server/context.ts';

let api: Api | null = null;
const get = () => (api ??= createApi(createContext(loadConfig(process.env, true))));

export function podstudioServer(): Plugin {
  return {
    name: 'podstudio-server',
    configureServer(server) {
      const a = get();
      server.middlewares.use((req, res, next) => a.handle(req, res, next));
      a.attach(server.httpServer as Server | null);
    },
  };
}
