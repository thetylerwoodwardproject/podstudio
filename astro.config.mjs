// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { relay } from './dev/relay.ts';

// Always https, with a self-signed certificate until Caddy or Nginx + Certbot is set up:
// browsers only allow the mic and recording storage on https (or localhost). The relay is
// the dev stand-in for the Podstudio server (guests, producer, uploads).

export default defineConfig({
  // Keep newline whitespace between inline elements ("speakers. ## Heading").
  compressHTML: false,
  server: { port: 4321, host: true },
  vite: {
    plugins: [tailwindcss(), basicSsl(), relay()],
  },
});
