import { DependencyUnavailableError, ValidationError } from '@app/application';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

/**
 * Resolves a claim-check reference to bytes.
 *
 * In this skeleton the store is a directory of fixtures. In production it is object storage, and
 * the reference should carry a content hash so a worker can tell that the bytes changed under it
 * (see ADR-0010). The interface is the same either way, which is the point of having one.
 */
export class FixturePayloadStore {
  private readonly root: string;

  constructor(fixturesDir: string) {
    this.root = resolve(fixturesDir);
  }

  /**
   * A payload reference arrives from a client over HTTP. Without this check, `../../etc/passwd` is
   * a valid import.
   */
  private resolveRef(payloadRef: string): string {
    if (isAbsolute(payloadRef) || payloadRef.includes('\0')) {
      throw new ValidationError('payloadRef must be a relative path', { payloadRef });
    }

    const target = resolve(join(this.root, normalize(payloadRef)));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new ValidationError('payloadRef escapes the payload store', { payloadRef });
    }
    return target;
  }

  openStream(payloadRef: string): Readable {
    return createReadStream(this.resolveRef(payloadRef), { encoding: 'utf8' });
  }

  async readText(payloadRef: string): Promise<string> {
    try {
      return await readFile(this.resolveRef(payloadRef), 'utf8');
    } catch (error: unknown) {
      throw toPayloadError(error, payloadRef);
    }
  }
}

/**
 * A missing payload is permanent: the reference points at something that is not there, and
 * retrying will not create it. Anything else about the store — a mount that went away, a network
 * filesystem timing out — is the world being temporarily unavailable, which is worth a retry.
 */
export const toPayloadError = (error: unknown, payloadRef: string): Error => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;

  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new ValidationError(`Payload ${payloadRef} does not exist`, { payloadRef, code });
  }

  return new DependencyUnavailableError(`Payload ${payloadRef} could not be read`, {
    payloadRef,
    code,
  });
};
