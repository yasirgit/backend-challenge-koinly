import type {
  GetImportUseCase,
  ListTransactionsUseCase,
  RegisterWalletUseCase,
  RequestImportUseCase,
} from '@app/application';
import { ImportId, WalletId } from '@app/domain';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  CORRELATION_HEADER,
  correlationIdOf,
  fingerprintOf,
  idempotencyKeyOf,
  userIdOf,
} from './http/context.js';
import { decodeCursor, encodeCursor } from './http/cursor.js';
import { toHttpError } from './http/errors.js';
import { importResponse, transactionResponse, walletResponse } from './http/serializers.js';

export interface ApiUseCases {
  readonly registerWallet: RegisterWalletUseCase;
  readonly requestImport: RequestImportUseCase;
  readonly getImport: GetImportUseCase;
  readonly listTransactions: ListTransactionsUseCase;
}

export interface BuildServerOptions {
  readonly useCases: ApiUseCases;
  readonly logger: FastifyBaseLogger;
  /**
   * Whether the process can serve its purpose right now. Supplied by the composition root, because
   * knowing how to ping PostgreSQL and RabbitMQ is an infrastructure concern and this module is not
   * allowed to import an adapter.
   */
  readonly checkReadiness: () => Promise<{ ok: boolean; checks: Record<string, boolean> }>;
}

const registerWalletBody = z.object({
  sourceType: z.string().min(1),
  sourceAccountRef: z.string().min(1).max(255),
  label: z.string().max(255).nullish(),
});

const requestImportBody = z.object({
  walletId: z.string().uuid(),
  payloadRef: z.string().min(1).max(1024),
});

const listTransactionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
});

export const buildServer = (options: BuildServerOptions): FastifyInstance => {
  const app = Fastify({
    loggerInstance: options.logger,
    // Correlation identifiers come from the caller when present, so Fastify's own request id should
    // agree with them rather than compete.
    genReqId: (request) => correlationIdOf(request),
    requestIdHeader: CORRELATION_HEADER,
  });

  app.addHook('onSend', (request, reply, payload, done) => {
    void reply.header(CORRELATION_HEADER, request.id);
    done(null, payload);
  });

  app.setErrorHandler((error, request, reply) => {
    const mapped = toHttpError(error, request.id);
    if (mapped.status >= 500) {
      request.log.error({ err: error }, 'request failed');
    } else {
      request.log.warn({ err: error, status: mapped.status }, 'request rejected');
    }
    void reply.status(mapped.status).send(mapped.body);
  });

  app.get('/healthz', () => ({ status: 'ok' }));

  app.get('/readyz', async (_request, reply) => {
    // Liveness says the process is running; readiness says it can do its job. Conflating them
    // makes an orchestrator restart a healthy process because a dependency blinked.
    const readiness = await options.checkReadiness();
    return reply.status(readiness.ok ? 200 : 503).send(readiness);
  });

  app.post('/v1/wallets', async (request, reply) => {
    const body = registerWalletBody.parse(request.body);
    const result = await options.useCases.registerWallet.execute({
      userId: userIdOf(request),
      sourceType: body.sourceType,
      sourceAccountRef: body.sourceAccountRef,
      label: body.label ?? null,
    });

    return reply.status(result.created ? 201 : 200).send(walletResponse(result.wallet));
  });

  app.post('/v1/imports', async (request, reply) => {
    const body = requestImportBody.parse(request.body);
    const result = await options.useCases.requestImport.execute({
      userId: userIdOf(request),
      walletId: WalletId(body.walletId),
      payloadRef: body.payloadRef,
      idempotencyKey: idempotencyKeyOf(request),
      requestFingerprint: fingerprintOf(request.body),
      correlationId: request.id,
    });

    // 202 for work that has been accepted and queued, 200 for a replay that changed nothing. The
    // distinction matters to a client deciding whether to start polling.
    return reply.status(result.created ? 202 : 200).send(importResponse(result.record));
  });

  app.get('/v1/imports/:importId', async (request, reply) => {
    const params = z.object({ importId: z.string().uuid() }).parse(request.params);
    const record = await options.useCases.getImport.execute({
      userId: userIdOf(request),
      importId: ImportId(params.importId),
    });

    return reply.send(importResponse(record));
  });

  app.get('/v1/wallets/:walletId/transactions', async (request, reply) => {
    const params = z.object({ walletId: z.string().uuid() }).parse(request.params);
    const query = listTransactionsQuery.parse(request.query);

    const page = await options.useCases.listTransactions.execute({
      userId: userIdOf(request),
      walletId: WalletId(params.walletId),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      cursor: query.cursor === undefined ? null : decodeCursor(query.cursor),
    });

    return reply.send({
      items: page.items.map(transactionResponse),
      nextCursor: page.nextCursor === null ? null : encodeCursor(page.nextCursor),
    });
  });

  return app;
};
