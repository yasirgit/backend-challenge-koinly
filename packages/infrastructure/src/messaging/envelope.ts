import type { ImportRequestedJob } from '@app/application';
import { ImportId, SourceType, WalletId } from '@app/domain';
import { z } from 'zod';

/**
 * The wire format.
 *
 * `schemaVersion` is the hook for evolving it: a consumer that meets a version it does not
 * understand can reject the message instead of misinterpreting it. There is no schema registry —
 * that would be infrastructure for a problem one message type does not have yet — but the field
 * costs nothing and its absence later would be expensive.
 */
export const IMPORT_REQUESTED = 'import.requested' as const;
export const SCHEMA_VERSION = 1 as const;

export const envelopeSchema = z.object({
  messageId: z.string().uuid(),
  type: z.literal(IMPORT_REQUESTED),
  schemaVersion: z.literal(SCHEMA_VERSION),
  occurredAt: z.string().datetime(),
  /** Threaded from the HTTP request so one import is greppable across both services. */
  correlationId: z.string().min(1).max(128),
  payload: z.object({
    importId: z.string().uuid(),
    walletId: z.string().uuid(),
    sourceType: z.string().min(1),
    // A pointer, never the bytes: see ADR-0010.
    payloadRef: z.string().min(1).max(1024),
  }),
});

export type ImportRequestedEnvelope = z.infer<typeof envelopeSchema>;

export const toEnvelope = (
  job: ImportRequestedJob,
  meta: { readonly messageId: string; readonly occurredAt: Date },
): ImportRequestedEnvelope => ({
  messageId: meta.messageId,
  type: IMPORT_REQUESTED,
  schemaVersion: SCHEMA_VERSION,
  occurredAt: meta.occurredAt.toISOString(),
  correlationId: job.correlationId,
  payload: {
    importId: job.importId,
    walletId: job.walletId,
    sourceType: job.sourceType,
    payloadRef: job.payloadRef,
  },
});

export const toJob = (envelope: ImportRequestedEnvelope): ImportRequestedJob => ({
  importId: ImportId(envelope.payload.importId),
  walletId: WalletId(envelope.payload.walletId),
  sourceType: SourceType(envelope.payload.sourceType),
  payloadRef: envelope.payload.payloadRef,
  correlationId: envelope.correlationId,
});

export class MalformedMessageError extends Error {
  constructor(readonly reason: string) {
    super(`Message does not match the import.requested envelope: ${reason}`);
    this.name = 'MalformedMessageError';
  }
}

/**
 * Parsing is separate from handling so a message that cannot be understood is treated as poison and
 * parked immediately. Redelivering it would produce the same failure forever, and a poison message
 * that keeps being retried is how a queue stops moving.
 */
export const parseEnvelope = (content: Buffer): ImportRequestedEnvelope => {
  let json: unknown;
  try {
    json = JSON.parse(content.toString('utf8'));
  } catch {
    throw new MalformedMessageError('body is not valid JSON');
  }

  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new MalformedMessageError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; '),
    );
  }
  return parsed.data;
};
