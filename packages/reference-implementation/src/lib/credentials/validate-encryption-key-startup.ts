import type { IEncryptionService } from '@uncefact/untp-ri-services/encryption';
// Relative imports (not the @/ alias): this module runs both inside the
// Next.js app (instrumentation.node.ts) and via tsx (prisma/seed.ts), which
// has no tsconfig.json to resolve path aliases.
import { parseEnvelope } from './decryption-key-protection';
import { ENVELOPE_STORE_IDS, ENVELOPE_STORE_INFO, type EnvelopeStoreId, type EnvelopeStores } from './envelope-stores';
import { apiLogger } from '../api/logger';

const logger = apiLogger.child({ module: 'validate-encryption-key-startup' });

const DOCS_URL =
  'https://uncefact.github.io/tests-untp/docs/next/reference-implementation/operations/startup#encryption-key-validation';

/**
 * The DATA_ENCRYPTION_KEY placeholder committed in .env.example. It is a
 * valid 64-character hex string, so it passes AesGcmEncryptionAdapter's
 * format check same as a real key, but it is public: anything encrypted
 * under it is recoverable by anyone who has read the file.
 */
export const PLACEHOLDER_ENCRYPTION_KEY = '0'.repeat(64);

const LOCAL_DEPLOYMENT_ENVIRONMENT = 'local';

export class PlaceholderEncryptionKeyError extends Error {
  constructor() {
    super(
      'DATA_ENCRYPTION_KEY is still set to the placeholder value published in .env.example. ' +
        'That value is public, so anything encrypted under it is not protected. Set a unique key ' +
        `(openssl rand -hex 32) before running outside local development. See ${DOCS_URL}`,
    );
    this.name = 'PlaceholderEncryptionKeyError';
  }
}

export class EncryptionKeyValidationError extends Error {
  /** `source` names the row and the value, e.g. "credential decryption key". */
  constructor(source: string, id: string, cause: unknown) {
    super(
      `DATA_ENCRYPTION_KEY cannot decrypt an existing ${source} ("${id}"). ` +
        `The configured key does not match the key the data was encrypted under. See ${DOCS_URL}`,
      { cause },
    );
    this.name = 'EncryptionKeyValidationError';
  }
}

/**
 * Refuses the DATA_ENCRYPTION_KEY placeholder published in .env.example
 * outside local development; warns and proceeds within it. "Local
 * development" is read from DEPLOYMENT_ENVIRONMENT, the same signal already
 * used to tag OpenTelemetry resources (see lib/observability/resource.ts),
 * defaulting to "local" when unset, which is the default a fresh checkout
 * gets before anyone has touched the variable.
 */
export function assertNotPlaceholderEncryptionKey(key: string, options: { deploymentEnvironment?: string } = {}): void {
  if (key !== PLACEHOLDER_ENCRYPTION_KEY) {
    return;
  }

  const environment = firstNonEmpty(options.deploymentEnvironment ?? process.env.DEPLOYMENT_ENVIRONMENT);
  if ((environment ?? LOCAL_DEPLOYMENT_ENVIRONMENT).toLowerCase() === LOCAL_DEPLOYMENT_ENVIRONMENT) {
    logger.warn(
      'DATA_ENCRYPTION_KEY is the placeholder value from .env.example. This is fine for local development ' +
        `but must be replaced before running anywhere else. See ${DOCS_URL}`,
    );
    return;
  }

  throw new PlaceholderEncryptionKeyError();
}

function firstNonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export type EncryptionKeyValidationResult =
  | { validated: true; source: EnvelopeStoreId; id: string }
  | { validated: false };

/**
 * Validates the active DATA_ENCRYPTION_KEY by decrypting one existing
 * encrypted envelope, so a key that cannot decrypt stored data fails fast at
 * boot instead of on the first request that happens to touch it.
 *
 * Mirrors the `backfill:decryption-keys` preflight (decrypt one envelope,
 * abort on failure, proceed when nothing exists): this runs on every
 * process boot, not as a one-off migration, so it favours a cheap, bounded
 * check over exhaustively verifying every row.
 *
 * Walks the stores that can prove the key in their listed order
 * (ENVELOPE_STORE_IDS): service instance configurations first, since every
 * writer encrypts one before persistence so any row is a valid sample, then
 * each keyed store only once the one before it is exhausted. A discardable
 * store is never sampled. Each store decides which rows are worth sampling
 * (`candidates`): where legacy plaintext may exist, only envelope-shaped
 * values.
 *
 * In every scan, a candidate that does not actually parse as an envelope
 * (corrupted or otherwise malformed) is logged and skipped rather than
 * treated as proof the key is wrong or that nothing is encrypted: a single
 * damaged row must never crash startup, or mask a genuinely wrong key
 * sitting in a later row, when other valid envelopes exist. Only a
 * genuine envelope that fails to *decrypt* is a key mismatch, and that
 * throws {@link EncryptionKeyValidationError} immediately. Returns
 * `{ validated: false }` (not an error) once every candidate across the
 * scans is exhausted with nothing to validate against, so a deployment
 * with nothing encrypted yet — or, in the pathological case, nothing but
 * corrupted rows — starts normally rather than crash-looping.
 */
export async function validateEncryptionKeyAtStartup(
  stores: EnvelopeStores,
  encryptionService: Pick<IEncryptionService, 'decrypt'>,
): Promise<EncryptionKeyValidationResult> {
  for (const id of ENVELOPE_STORE_IDS) {
    const info = ENVELOPE_STORE_INFO[id];
    if (info.discardable) {
      // A discardable value proves nothing about the key (it may predate a
      // rotation), and its store is unbounded; sampling it would make boot
      // neither a proof nor cheap.
      continue;
    }
    const source = `${info.rowName} ${info.valueName}`;
    for await (const row of stores[id].candidates()) {
      const envelope = parseEnvelope(row.value);
      if (envelope === null) {
        logger.warn(
          { [info.logIdField]: row.id },
          `Skipping ${source} "${row.id}" as a validation sample: it is not a valid encrypted envelope`,
        );
        continue;
      }
      try {
        encryptionService.decrypt(envelope);
      } catch (error) {
        logger.error(
          { err: error, source, id: row.id },
          'DATA_ENCRYPTION_KEY failed to decrypt an existing envelope at startup',
        );
        throw new EncryptionKeyValidationError(source, row.id, error);
      }
      return { validated: true, source: id, id: row.id };
    }
  }

  return { validated: false };
}
