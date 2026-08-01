import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    // `tsc --build` emits compiled copies of the tests into each package's
    // dist/. Without this they get collected as well, so every test runs twice
    // and the integration suite races itself for the same port.
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-types/**'],
  },
});
