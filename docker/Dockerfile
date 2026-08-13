# One image, four commands (api, worker, migrate, seed). See ADR-0002: the runtime role is a
# start command, not a separate artifact, so a schema change and the code that needs it ship
# together.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# Manifests first so the dependency layer is cached independently of source changes.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/application/package.json packages/application/
COPY packages/infrastructure/package.json packages/infrastructure/
COPY packages/api/package.json packages/api/
COPY packages/worker/package.json packages/worker/
# tests/e2e is a workspace member too, but only its manifest is needed here: pnpm resolves the
# workspace from the lockfile, and the suite itself has no business in a runtime image.
COPY tests/e2e/package.json tests/e2e/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
# Building the two entrypoints rather than the whole solution keeps test sources out of the image.
# `tsc -b` walks their project references, so this still compiles — and re-checks — the layer graph.
RUN pnpm exec tsc -b packages/api packages/worker

# Production dependencies only, installed fresh rather than pruned, then the compiled output on top.
FROM base AS runtime
ENV NODE_ENV=production
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/application/package.json packages/application/
COPY packages/infrastructure/package.json packages/infrastructure/
COPY packages/api/package.json packages/api/
COPY packages/worker/package.json packages/worker/
# Same reason as the deps stage: the lockfile lists tests/e2e as a workspace importer, so a
# frozen install fails unless the manifest is present. The suite itself is not copied.
COPY tests/e2e/package.json tests/e2e/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=build /app/packages/application/dist packages/application/dist
COPY --from=build /app/packages/infrastructure/dist packages/infrastructure/dist
COPY --from=build /app/packages/api/dist packages/api/dist
COPY --from=build /app/packages/worker/dist packages/worker/dist
COPY fixtures fixtures

USER node
# Exec form so node is PID 1 and receives SIGTERM directly; the worker needs it to drain cleanly.
CMD ["node", "packages/api/dist/main.js"]
