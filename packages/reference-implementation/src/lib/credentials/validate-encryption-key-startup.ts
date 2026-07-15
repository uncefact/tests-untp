import type { EncryptedEnvelope, IEncryptionService } from '@uncefact/untp-ri-services/encryption';
// Relative imports (not the @/ alias): this module runs both inside the
// Next.js app (instrumentation.node.ts) and via tsx (prisma/seed.ts), which
// has no tsconfig.json to resolve path aliases.
import { isProtectedDecryptionKey } from './decryption-key-protection';
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
const PLACEHOLDER_ENCRYPTION_KEY = '0'.repeat(64);

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
  constructor(source: 'service instance configuration' | 'credential decryption key', id: string, cause: unknown) {
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

type ServiceInstanceRow = { id: string; config: string };
type CredentialRow = { id: string; decryptionKey: string | null };

/**
 * The subset of the Prisma client this check needs; structural so tests can
 * supply an in-memory fake (same approach as BackfillClient).
 */
export type EncryptionKeyValidationClient = {
  serviceInstance: {
    findFirst(args: { select: { id: true; config: true } }): Promise<ServiceInstanceRow | null>;
  };
  credential: {
    findFirst(args: {
      where: { decryptionKey: { startsWith: string } };
      select: { id: true; decryptionKey: true };
    }): Promise<CredentialRow | null>;
  };
};

export type EncryptionKeyValidationResult =
  | { validated: true; source: 'service-instance' | 'credential'; id: string }
  | { validated: false };

/**
 * Validates the active DATA_ENCRYPTION_KEY by decrypting one existing
 * encrypted envelope, so a key that cannot decrypt stored data fails fast at
 * boot instead of on the first request that happens to touch it.
 *
 * Mirrors the `backfill:decryption-keys` preflight (decrypt one envelope,
 * abort on failure, proceed when nothing exists), but stops at the first
 * envelope found rather than checking every row: this runs on every process
 * boot, not as a one-off migration, so it favours a cheap, bounded check
 * over exhaustive verification.
 *
 * Prefers a service instance configuration: every writer encrypts it before
 * persistence, so any row is a valid sample. Falls back to a credential's
 * protected decryption key only when no service instance exists yet.
 * Returns `{ validated: false }` (not an error) when nothing encrypted
 * exists anywhere, so a deployment with nothing encrypted yet starts
 * normally.
 */
export async function validateEncryptionKeyAtStartup(
  client: EncryptionKeyValidationClient,
  encryptionService: Pick<IEncryptionService, 'decrypt'>,
): Promise<EncryptionKeyValidationResult> {
  const instance = await client.serviceInstance.findFirst({ select: { id: true, config: true } });
  if (instance) {
    decryptOrThrow(
      () => encryptionService.decrypt(JSON.parse(instance.config) as EncryptedEnvelope),
      'service instance configuration',
      instance.id,
    );
    return { validated: true, source: 'service-instance', id: instance.id };
  }

  // Envelopes are JSON objects, so a plaintext legacy key (a bare hex
  // string) never matches this filter; the DB does the row-shape filtering
  // instead of pulling every keyed credential into the process.
  const credential = await client.credential.findFirst({
    where: { decryptionKey: { startsWith: '{' } },
    select: { id: true, decryptionKey: true },
  });
  if (credential?.decryptionKey && isProtectedDecryptionKey(credential.decryptionKey)) {
    const decryptionKey = credential.decryptionKey;
    decryptOrThrow(
      () => encryptionService.decrypt(JSON.parse(decryptionKey) as EncryptedEnvelope),
      'credential decryption key',
      credential.id,
    );
    return { validated: true, source: 'credential', id: credential.id };
  }

  return { validated: false };
}

function decryptOrThrow(
  decrypt: () => string,
  source: 'service instance configuration' | 'credential decryption key',
  id: string,
): void {
  try {
    decrypt();
  } catch (error) {
    logger.error({ err: error, source, id }, 'DATA_ENCRYPTION_KEY failed to decrypt an existing envelope at startup');
    throw new EncryptionKeyValidationError(source, id, error);
  }
}
