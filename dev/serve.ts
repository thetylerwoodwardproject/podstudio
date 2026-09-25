/*
 * `npm run preview`: serves the built site (dist/) over https with a
 * self-signed certificate, plus the dev relay (guests, producer, uploads).
 * Astro's own preview drops Vite plugins, so this runs Vite's preview directly.
 */
import basicSsl from '@vitejs/plugin-basic-ssl';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { preview, type Plugin } from 'vite';
import { relay } from './relay.ts';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

// Astro pages are folders (episodes/142/recording/index.html): serve /episodes/142/recording too.
const pages: Plugin = {
  name: 'podstudio-pages',
  configurePreviewServer(server) {
    server.middlewares.use((req, _res, next) => {
      const [path, query = ''] = (req.url ?? '/').split('?');
      if (!path.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(path) && !path.endsWith('/') && existsSync(join('dist', path, 'index.html'))) {
        req.url = `${path}/${query ? `?${query}` : ''}`;
      }
      next();
    });
  },
};

const server = await preview({
  configFile: false,
  root: process.cwd(),
  appType: 'mpa',
  build: { outDir: 'dist' },
  preview: { host: true, port: Number(arg('port') ?? 4321), strictPort: true },
  plugins: [basicSsl(), pages, relay()],
});
server.printUrls();
