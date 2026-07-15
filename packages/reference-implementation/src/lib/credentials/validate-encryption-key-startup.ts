import type { IEncryptionService } from '@uncefact/untp-ri-services/encryption';
// Relative imports (not the @/ alias): this module runs both inside the
// Next.js app (instrumentation.node.ts) and via tsx (prisma/seed.ts), which
// has no tsconfig.json to resolve path aliases.
import { parseEnvelope } from './decryption-key-protection';
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
 * Thrown when the sample value startup picked to validate against is not a
 * well-formed encrypted envelope — it failed to parse as JSON, or parsed
 * but does not have the envelope shape. This is corruption, not a key
 * problem: unlike a credential's decryption key (which can legitimately
 * hold a pre-#697 plaintext value), a service instance configuration has no
 * legacy unencrypted form, so every writer already guarantees it is a valid
 * envelope. Distinct from {@link EncryptionKeyValidationError} so an
 * operator is not sent chasing DATA_ENCRYPTION_KEY for a problem that
 * changing the key cannot fix.
 */
export class CorruptedEnvelopeError extends Error {
  constructor(source: 'service instance configuration', id: string) {
    super(
      `Existing ${source} ("${id}") is not a valid encrypted envelope: it failed to parse as JSON, or does not ` +
        'have the shape of one. This is data corruption, not a DATA_ENCRYPTION_KEY mismatch — changing the key ' +
        `will not fix it. Investigate the row directly. See ${DOCS_URL}`,
    );
    this.name = 'CorruptedEnvelopeError';
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

const CANDIDATE_BATCH_SIZE = 100;

/**
 * The subset of the Prisma client this check needs; structural so tests can
 * supply an in-memory fake (same approach as BackfillClient). Credentials
 * are fetched via cursor-paginated `findMany`, not `findFirst`: the
 * `startsWith` filter only narrows to envelope-*shaped* candidates (a
 * truncated/corrupted value can also start with "{"), and the first
 * candidate is not necessarily a valid one, so the caller must be able to
 * keep scanning past it.
 */
export type EncryptionKeyValidationClient = {
  serviceInstance: {
    findFirst(args: { select: { id: true; config: true } }): Promise<ServiceInstanceRow | null>;
  };
  credential: {
    findMany(args: {
      where: { decryptionKey: { startsWith: string }; id?: { gt: string } };
      select: { id: true; decryptionKey: true };
      orderBy: { id: 'asc' };
      take: number;
    }): Promise<CredentialRow[]>;
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
 * abort on failure, proceed when nothing exists): this runs on every
 * process boot, not as a one-off migration, so it favours a cheap, bounded
 * check over exhaustively verifying every row.
 *
 * Prefers a service instance configuration: every writer encrypts it before
 * persistence, so any row is a valid sample, and a row that fails to parse
 * as an envelope is corruption (see {@link CorruptedEnvelopeError}), not a
 * legacy-plaintext possibility. Falls back to a credential's decryption key
 * only when no service instance exists yet — credentials predating #697
 * can legitimately hold plaintext, so candidates are scanned in
 * deterministic (id) order until one actually parses as an envelope,
 * skipping corrupted-but-envelope-shaped rows along the way rather than
 * treating the first candidate's shape failure as "nothing encrypted": a
 * corrupted row must never mask a genuinely wrong key sitting in a later
 * row. Returns `{ validated: false }` (not an error) only once every
 * candidate is exhausted with nothing to validate against, so a deployment
 * with nothing encrypted yet starts normally.
 */
export async function validateEncryptionKeyAtStartup(
  client: EncryptionKeyValidationClient,
  encryptionService: Pick<IEncryptionService, 'decrypt'>,
): Promise<EncryptionKeyValidationResult> {
  const instance = await client.serviceInstance.findFirst({ select: { id: true, config: true } });
  if (instance) {
    const envelope = parseEnvelope(instance.config);
    if (envelope === null) {
      logger.error({ instanceId: instance.id }, 'Service instance configuration is not a valid encrypted envelope');
      throw new CorruptedEnvelopeError('service instance configuration', instance.id);
    }
    decryptOrThrow(() => encryptionService.decrypt(envelope), 'service instance configuration', instance.id);
    return { validated: true, source: 'service-instance', id: instance.id };
  }

  for await (const row of eachCandidateCredential(client)) {
    const envelope = parseEnvelope(row.decryptionKey);
    if (envelope === null) {
      // Envelope-shaped (starts with "{") but not a genuine envelope:
      // corruption or a coincidental legacy value. Neither proves anything
      // about the key, so keep scanning rather than reporting "nothing
      // encrypted" on the strength of one bad row.
      continue;
    }
    decryptOrThrow(() => encryptionService.decrypt(envelope), 'credential decryption key', row.id);
    return { validated: true, source: 'credential', id: row.id };
  }

  return { validated: false };
}

/**
 * Iterates credential rows whose decryption key looks envelope-shaped, in
 * id order via cursor pagination — same approach as the backfill script's
 * `eachKeyedRow`, so a row deleted mid-scan cannot skip a surviving one.
 */
async function* eachCandidateCredential(
  client: EncryptionKeyValidationClient,
): AsyncGenerator<{ id: string; decryptionKey: string }> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await client.credential.findMany({
      where: { decryptionKey: { startsWith: '{' }, ...(cursor !== undefined && { id: { gt: cursor } }) },
      select: { id: true, decryptionKey: true },
      orderBy: { id: 'asc' },
      take: CANDIDATE_BATCH_SIZE,
    });
    if (rows.length === 0) {
      return;
    }
    cursor = rows[rows.length - 1].id;
    for (const row of rows) {
      if (row.decryptionKey !== null) {
        yield { id: row.id, decryptionKey: row.decryptionKey };
      }
    }
  }
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
