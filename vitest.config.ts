import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['compiler/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});