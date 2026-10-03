import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // The whole-night bot tests play dozens of full runs; CI runners are several times slower than a laptop.
    testTimeout: 90_000,
    include: ['tests/sim/**/*.test.ts', 'tests/audio/**/*.test.ts', 'tests/game/**/*.test.ts'],
  },
});
