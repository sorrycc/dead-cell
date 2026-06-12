import { defineConfig } from 'vite'

// Relative base so the production build runs from any sub-path or a file:// preview
// (design Decision 7). Mirrors the sibling crowd-runner's config.
export default defineConfig({
  base: './',
  server: { open: true },
})
