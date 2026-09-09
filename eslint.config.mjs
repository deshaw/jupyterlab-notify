import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import jupyterPlugin from '@jupyter/eslint-plugin';
import globals from 'globals';

export default defineConfig([
  {
    ignores: [
      'node_modules/**',
      '**/node_modules/**',
      '**/lib/**',
      '**/dist/**',
      '**/build/**',
      'coverage/**',
      'jupyterlab_notify/**',
      'style/**',
      'ui-tests/**',
      'docs/**',
      'binder/**',
      '**/*.d.ts',
      '**/*.bundle.js',
      '**/*.map.js',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    plugins: {
      jupyter: jupyterPlugin,
    },
  },
  jupyterPlugin.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2020,
        ...globals.node,
      },
      parserOptions: {
        project: 'tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'interface',
          format: ['PascalCase'],
          custom: {
            regex: '^I[A-Z]',
            match: true,
          },
        },
      ],
      '@typescript-eslint/no-unused-vars': ['warn', { args: 'none' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-use-before-define': 'off',
      curly: ['error', 'all'],
      eqeqeq: 'error',
      'prefer-arrow-callback': 'error',
    },
  },
  eslintPluginPrettierRecommended,
]);
