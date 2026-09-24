// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Keep newline whitespace between inline elements ("speakers. ## Heading").
  compressHTML: false,
  server: { port: 4321, host: true },
  vite: {
    plugins: [tailwindcss()],
  },
});
