/**
 * Module-graph rules. These complement, rather than duplicate, the two stronger mechanisms:
 * pnpm workspace dependencies (a package cannot import what it does not declare) and TypeScript
 * project references (an unreferenced project fails `tsc -b`).
 *
 * What is left for this file is the set of rules those two cannot express: intra-package layering,
 * and the fact that `api` and `worker` legitimately depend on `infrastructure` but only their
 * composition roots may use that dependency.
 *
 * See docs/adr/0003-enforced-boundaries.md.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'A cycle means the two modules are really one module, and it makes the layering unfalsifiable.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment:
        'The domain layer holds business rules and must stay free of I/O, frameworks and other layers.',
      from: { path: '^packages/domain/src' },
      to: {
        pathNot: '^packages/domain/src',
        dependencyTypes: ['local'],
      },
    },
    {
      name: 'domain-has-no-io',
      severity: 'error',
      comment: 'No node builtins in the domain: it must be runnable and testable without a machine.',
      from: { path: '^packages/domain/src' },
      to: { dependencyTypes: ['core'], pathNot: '^(node:)?crypto$' },
    },
    {
      name: 'application-depends-on-domain-only',
      severity: 'error',
      comment:
        'The application layer orchestrates the domain through ports. It must not know any adapter.',
      from: { path: '^packages/application/src' },
      to: { path: '^packages/(infrastructure|api|worker)/src' },
    },
    {
      name: 'infrastructure-uses-ports-not-use-cases',
      severity: 'error',
      comment:
        'Adapters implement ports. Wiring an adapter to a use case is the composition root\'s job, so an adapter that reaches for a use case has inverted the dependency.',
      from: { path: '^packages/infrastructure/src' },
      to: { path: '^packages/application/src/use-cases' },
    },
    {
      name: 'entrypoints-are-not-imported',
      severity: 'error',
      comment: 'Nothing may depend on api or worker; they are leaves of the graph.',
      from: { pathNot: '^packages/(api|worker)/src' },
      to: { path: '^packages/(api|worker)/src' },
    },
    {
      name: 'only-composition-roots-touch-adapters',
      severity: 'error',
      comment:
        'Routes and message handlers must go through use cases. Only container.ts and main.ts may name a concrete adapter, which is what stops a handler from quietly bypassing its use case.',
      from: {
        path: '^packages/(api|worker)/src',
        pathNot: '^packages/(api|worker)/src/(container|main)\\.ts$',
      },
      to: { path: '^packages/infrastructure' },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'An orphaned module is either dead code or a missing wire-up.',
      from: {
        orphan: true,
        pathNot: ['\\.d\\.ts$', '(^|/)tsconfig\\.json$', '(^|/)index\\.ts$'],
      },
      to: {},
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment: 'Shipping code must not depend on a devDependency; it will not exist in production.',
      from: { path: '^packages/.+/src', pathNot: '\\.test\\.ts$|/testing/' },
      to: { dependencyTypes: ['npm-dev'] },
    },
    {
      name: 'no-undeclared-deps',
      severity: 'error',
      comment:
        'pnpm hoists root devDependencies into a directory every package can walk up to. This rule closes that hole: a package may only import what its own package.json declares.',
      from: { path: '^packages/.+/src', pathNot: '\\.test\\.ts$|/testing/' },
      to: { dependencyTypes: ['unknown', 'undetermined', 'npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'no-deprecated-core',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['core'], path: '^(punycode|domain|sys|util\\.promisify)$' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.test\\.ts$|/dist/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
