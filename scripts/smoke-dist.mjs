/**
 * Loads every compiled package entrypoint under plain Node.
 *
 * Vitest runs the TypeScript sources through esbuild, which emits different JavaScript from `tsc`
 * for the same input. A green test run therefore says nothing about whether the artifact that
 * actually ships can be loaded at all: this repository has already had a class whose static
 * initializer worked under esbuild and threw under `tsc` output, and the first thing that noticed
 * was a container restart loop. Ten seconds of `import()` here closes that gap.
 *
 * Importing must stay side-effect free — no connections, no listeners — which is itself worth
 * enforcing, since a module that dials a database on import cannot be unit tested either.
 */
const entrypoints = [
  './packages/domain/dist/index.js',
  './packages/application/dist/index.js',
  // @app/application/testing is deliberately absent: it imports vitest, so it only loads under a
  // test runner. That is the one entrypoint no production process is allowed to reach anyway.
  './packages/infrastructure/dist/index.js',
  './packages/api/dist/index.js',
  './packages/worker/dist/index.js',
];

let failed = false;

for (const entrypoint of entrypoints) {
  try {
    const module = await import(new URL(entrypoint, `file://${process.cwd()}/`).href);
    const exported = Object.keys(module).length;
    if (exported === 0) {
      throw new Error('module loaded but exports nothing');
    }
    process.stdout.write(`ok   ${entrypoint} (${String(exported)} exports)\n`);
  } catch (error) {
    failed = true;
    process.stdout.write(`FAIL ${entrypoint}\n`);
    process.stdout.write(`     ${error instanceof Error ? error.message : 'unknown error'}\n`);
  }
}

process.exit(failed ? 1 : 0);
