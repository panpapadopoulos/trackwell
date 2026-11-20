import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'node_modules',
      '.impeccable',
      '.wrangler',
      '.local',
      '.taste-skill',
      'playwright-report',
      'test-results',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
    },
  },
  {
    files: ['**/*.mjs'],
    // e2e scripts run code in the page via page.evaluate, so they need browser globals too
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // The verbatim legacy copy is kept byte-for-byte; lint must not pressure edits to it.
    files: ['src/domain/legacy/**'],
    rules: { '@typescript-eslint/no-unused-vars': 'off' },
  },
);
