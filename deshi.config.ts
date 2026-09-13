import { defineConfig } from './compiler/config';

export default defineConfig({
  site: 'https://deshi.example.com',
  base: '/',
  output: 'static',
  trailingSlash: 'ignore',
  appDir: 'src',
  outDir: 'dist',
  router: true,
  css: 'inline',
  experimental: {
    viewTransitions: false,
    contentCollections: true,
  },
});
