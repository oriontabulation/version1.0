import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom', // Optional, add if components need DOM
    globals: true,
    include: ['tests/unit/**/*.{test,spec}.js'],
  },
});
