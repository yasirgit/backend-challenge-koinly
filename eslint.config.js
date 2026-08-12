import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Rules that exist to protect architectural invariants, not style. Style is not enforced here on
 * purpose: it is noise in a review, and a formatter belongs in a pre-commit hook rather than in the
 * build.
 */
const determinismRules = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "MemberExpression[object.name='Date'][property.name='now']",
      message:
        'Wall-clock access breaks determinism. Take the time from the Clock port instead (see NFR-4).',
    },
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message:
        'Wall-clock access breaks determinism. Take the time from the Clock port instead (see NFR-4).',
    },
    {
      selector: "MemberExpression[object.name='Math'][property.name='random']",
      message: 'Randomness breaks determinism. Take identifiers from the IdGenerator port instead.',
    },
    {
      selector: "CallExpression[callee.name='parseFloat']",
      message: 'Floating point must never touch monetary values. Use Decimal (see ADR-0004).',
    },
    {
      selector: "CallExpression[callee.name='parseInt']",
      message: 'Parse numbers explicitly with Number.parseInt and a radix, or use Decimal.',
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'coverage/**',
      'eslint.config.js',
      'vitest.config.ts',
      'vitest.integration.config.ts',
      '.dependency-cruiser.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    // Type-aware linting needs a project for every file it touches, and the end-to-end suite is a
    // project of its own precisely so it can import both entrypoints.
    files: ['packages/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      // A dropped promise in a queue consumer is a lost or double-processed message.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'Only @app/infrastructure/config may read the environment. Inject configuration instead.',
        },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'error',
    },
  },
  {
    // The domain and the application layer must be deterministic and free of ambient I/O.
    files: ['packages/domain/**/*.ts', 'packages/application/**/*.ts'],
    rules: determinismRules,
  },
  {
    // The composition roots, the config loader, and test harnesses pointing at local containers.
    files: [
      'packages/infrastructure/src/config/**/*.ts',
      'packages/*/src/main.ts',
      'packages/*/src/container.ts',
      'packages/*/src/testing/**/*.ts',
    ],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['packages/infrastructure/src/adapters/clock.ts', 'packages/infrastructure/src/adapters/id-generator.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // Plain-JavaScript tooling scripts have no type information, so the type-aware rules cannot run.
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: { process: 'readonly', URL: 'readonly' },
    },
  },
  {
    files: ['**/*.test.ts', '**/testing/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      'no-restricted-syntax': 'off',
    },
  },
);
