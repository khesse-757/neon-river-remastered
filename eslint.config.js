import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'node_modules/',
      'reference/',
      'artifacts/',
      'test-results/',
      'playwright-report/',
      '.claude/',
      'public/',
      'scripts/inspect-threejs-canvas.mjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.es2022 } },
    rules: {
      '@typescript-eslint/explicit-function-return-type': ['warn', { allowExpressions: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // The simulation is pure: no renderer, DOM, audio, timers, or unseeded randomness.
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['three', 'three/*', '../render/*', '../audio/*', '../ui/*', '../input/*', '../game/*'] },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'setTimeout',
        'setInterval',
        'requestAnimationFrame',
        'performance',
        'AudioContext',
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG.' },
        { object: 'Date', property: 'now', message: 'The sim runs on its own clock.' },
      ],
    },
  },
  {
    // No unseeded randomness anywhere in game code; cosmetic effects use their own seeded RNG too.
    files: ['src/**/*.ts'],
    rules: { 'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use a seeded RNG (src/sim/rng.ts).' }] },
  },
  { files: ['scripts/**/*.mjs', '*.config.js', '*.config.ts'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  { files: ['tests/**/*.ts'], rules: { '@typescript-eslint/explicit-function-return-type': 'off' } },
  prettier,
);
