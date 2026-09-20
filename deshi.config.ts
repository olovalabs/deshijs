import { defineConfig } from './compiler/config';

export default defineConfig({
  site: 'https://deshi.example.com',
  base: '/',
  output: 'static',
  trailingSlash: 'ignore',
  appDir: 'src',
  outDir: 'dist',
  // Static HTML by default. Browser JavaScript is emitted only by *.client.tsx islands.
  router: false,
  css: 'inline',
  experimental: {
    viewTransitions: false,
    contentCollections: true,
  },
});
