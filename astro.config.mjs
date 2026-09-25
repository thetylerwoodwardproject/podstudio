// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS=1 (npm run dev:phone) serves over https with a self-signed certificate, so a
// phone on the same network gets the mic and storage, which browsers only allow on https.
const https = /** @type {any} */ (globalThis).process?.env?.HTTPS === '1';

export default defineConfig({
  // Keep newline whitespace between inline elements ("speakers. ## Heading").
  compressHTML: false,
  server: { port: 4321, host: true },
  vite: {
    plugins: [tailwindcss(), ...(https ? [basicSsl()] : [])],
  },
});
