// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import node from '@astrojs/node';
import svelte from '@astrojs/svelte';
import { podstudioServer } from './dev/server-plugin.ts';

// Pages are built ahead of time where they can be; the Node adapter serves the rest, and
// server/main.ts puts the API and live room in front (Caddy adds HTTPS in production).
// `npm run dev` is always https, with a self-signed certificate: browsers only allow the
// mic and recording storage on https (or localhost).

export default defineConfig({
  // Keep newline whitespace between inline elements ("speakers. ## Heading").
  compressHTML: false,
  adapter: node({ mode: 'standalone' }),
  // Svelte for stateful panels (the Tone card first); pages and layout stay .astro.
  integrations: [svelte()],
  server: { port: 4321, host: true },
  vite: {
    plugins: [tailwindcss(), basicSsl(), podstudioServer()],
  },
});
