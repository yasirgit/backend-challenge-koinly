import type { ConfirmChannel } from 'amqplib';

/**
 * The queue topology, declared in one place so the publisher, the consumer and the operator's
 * mental model cannot disagree.
 *
 *   koinly.imports (topic)
 *     └── import.requested ──► imports.normalize        durable, manual ack, prefetch N
 *                                  │
 *                                  │ retryable failure: republished with attempt + 1
 *                                  ▼
 *                              imports.normalize.retry  x-message-ttl, dead-letters back
 *                                  │  (TTL expiry routes it to import.requested again)
 *                                  └──────────────────► imports.normalize
 *
 *     permanent failure or attempts exhausted ────────► koinly.imports.dlx ──► imports.dlq
 *
 * The dead-letter queue has no consumer on purpose: it is a parking lot, and a human decides what
 * happens to what lands there.
 */
export const TOPOLOGY = {
  exchange: 'koinly.imports',
  routingKey: 'import.requested',
  queue: 'imports.normalize',
  retryQueue: 'imports.normalize.retry',
  deadLetterExchange: 'koinly.imports.dlx',
  deadLetterQueue: 'imports.dlq',
} as const;

export const assertTopology = async (
  channel: ConfirmChannel,
  options: { readonly retryDelayMs: number },
): Promise<void> => {
  await channel.assertExchange(TOPOLOGY.exchange, 'topic', { durable: true });
  await channel.assertExchange(TOPOLOGY.deadLetterExchange, 'topic', { durable: true });

  await channel.assertQueue(TOPOLOGY.queue, { durable: true });
  await channel.bindQueue(TOPOLOGY.queue, TOPOLOGY.exchange, TOPOLOGY.routingKey);

  // The delay is the queue's message TTL, and expiry dead-letters the message back onto the main
  // exchange. No scheduler, no timer in the application.
  //
  // The limitation to know about: a TTL queue expires messages in publication order, so a single
  // queue cannot serve several delays — a long one would block shorter ones behind it. That is why
  // this is one fixed delay plus a bounded attempt count rather than exponential backoff; tiered
  // backoff needs one queue per tier.
  await channel.assertQueue(TOPOLOGY.retryQueue, {
    durable: true,
    arguments: {
      'x-message-ttl': options.retryDelayMs,
      'x-dead-letter-exchange': TOPOLOGY.exchange,
      'x-dead-letter-routing-key': TOPOLOGY.routingKey,
    },
  });

  await channel.assertQueue(TOPOLOGY.deadLetterQueue, { durable: true });
  await channel.bindQueue(TOPOLOGY.deadLetterQueue, TOPOLOGY.deadLetterExchange, '#');
};
