import { defineConfig } from 'deshijs/config';

export default defineConfig({
  site: 'https://deshi.example.com',
  base: '/',
  output: 'static',
  trailingSlash: 'ignore',
  appDir: 'src',
  outDir: 'dist',
  router: true,
  css: 'inline',
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      langs: ['ts', 'tsx'],
    },
  },
  experimental: {
    viewTransitions: false,
    contentCollections: true,
  },
});
