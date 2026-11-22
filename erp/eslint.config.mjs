import tseslint from 'typescript-eslint';
import lit from 'eslint-plugin-lit';
import wc from 'eslint-plugin-wc';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.nx/**',
      'coverage/**',
      '**/*.styles.generated.ts',
      '**/vitest.config.ts',
    ],
  },
  {
    files: ['apps/**/*.ts', 'packages/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: [
          './apps/operations/tsconfig.app.json',
          './apps/operations/tsconfig.spec.json',
          './apps/operations-e2e/tsconfig.json',
          './apps/website/tsconfig.app.json',
          './apps/website/tsconfig.spec.json',
          './packages/domain-core/tsconfig.lib.json',
          './packages/domain-core/tsconfig.spec.json',
          './packages/local-store/tsconfig.lib.json',
          './packages/local-store/tsconfig.spec.json',
          './packages/soap-formulation/tsconfig.lib.json',
          './packages/soap-formulation/tsconfig.spec.json',
          './packages/worker-protocol/tsconfig.lib.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-check': false, 'ts-expect-error': 'allow-with-description' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    files: ['packages/vector-widgets/src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: [
          './packages/vector-widgets/tsconfig.lib.json',
          './packages/vector-widgets/tsconfig.spec.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      lit,
      wc,
    },
    rules: {
      ...lit.configs['flat/recommended'].rules,
      ...wc.configs['flat/recommended'].rules,
      'lit/lifecycle-super': 'error',
      'lit/no-legacy-imports': 'error',
      'lit/prefer-static-styles': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
);
