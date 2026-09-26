import { vitePreprocess } from '@astrojs/svelte';

// TypeScript in <script lang="ts"> blocks.
export default {
  preprocess: vitePreprocess(),
};
