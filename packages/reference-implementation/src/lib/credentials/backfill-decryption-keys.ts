import {
  isProtectedDecryptionKey,
  looksEnvelopeLikeButInvalid,
  protectDecryptionKey,
  revealDecryptionKey,
} from './decryption-key-protection';

export type BackfillDecryptionKeysResult = {
  wrapped: number;
  alreadyProtected: number;
  /** False when no existing envelope was available to validate the key against. */
  keyVerified: boolean;
  /**
   * Rows whose stored value resembles an encrypted envelope but is not one
   * (truncated or corrupted data). Left untouched: they are neither
   * decryptable nor plausible legacy plaintext, so wrapping them would
   * launder corruption into a valid-looking envelope.
   */
  suspectRowIds: string[];
  /** Rows deleted between being fetched and being updated. */
  deletedRowIds: string[];
};

export type BackfillDecryptionKeysOptions = {
  /**
   * Proceed with wrapping even when no existing envelope validates the
   * active key. Wrapping under a wrong key is unrecoverable, so this is an
   * explicit operator decision, never a default.
   */
  force?: boolean;
};

type CredentialKeyRow = { id: string; decryptionKey: string | null };
type ServiceInstanceConfigRow = { id: string; config: string };

/**
 * The subset of the Prisma client the backfill needs; structural so tests can
 * supply an in-memory fake.
 */
export type BackfillClient = {
  credential: {
    findMany(args: {
      where: { decryptionKey: { not: null }; id?: { gt: string } };
      select: { id: true; decryptionKey: true };
      orderBy: { id: 'asc' };
      take: number;
    }): Promise<CredentialKeyRow[]>;
    update(args: { where: { id: string }; data: { decryptionKey: string } }): Promise<unknown>;
  };
  serviceInstance: {
    findMany(args: {
      where?: { id?: { gt: string } };
      select: { id: true; config: true };
      orderBy: { id: 'asc' };
      take: number;
    }): Promise<ServiceInstanceConfigRow[]>;
  };
};

const BATCH_SIZE = 100;

/**
 * Error thrown when no existing envelope is available to prove the active
 * DATA_ENCRYPTION_KEY and the caller did not pass `force`. Exposed as a class
 * so the CLI can distinguish the refusal from other failures.
 */
export class KeyUnverifiedError extends Error {
  constructor() {
    super(
      'Refusing to wrap plaintext decryption keys: no existing encrypted value ' +
        '(credential key or service instance configuration) is available to prove that ' +
        'DATA_ENCRYPTION_KEY matches the key the application runs with. Wrapping under a ' +
        'wrong key is unrecoverable. Verify the key out of band and re-run with --force.',
    );
    this.name = 'KeyUnverifiedError';
  }
}

/**
 * Encrypts plaintext credential decryption keys in place. Rows already
 * holding an encrypted envelope are left untouched, so re-running converges
 * to no changes.
 *
 * Before writing anything, the preflight decrypts every existing envelope it
 * can find: all protected credential keys and all service instance
 * configurations (both are encrypted under the same DATA_ENCRYPTION_KEY).
 * Any decrypt failure aborts the run, naming the failing row: wrapping
 * plaintext under a wrong key would be unrecoverable (the plaintext is
 * overwritten, and a re-run would count the rows as already protected).
 * When no envelope exists anywhere and there is plaintext to wrap, the run
 * refuses unless `force` is passed.
 */
export async function backfillDecryptionKeys(
  client: BackfillClient,
  options: BackfillDecryptionKeysOptions = {},
): Promise<BackfillDecryptionKeysResult> {
  const preflight = await verifyKeyAgainstAllEnvelopes(client);

  if (!preflight.keyVerified && preflight.wrappableRows > 0 && !options.force) {
    throw new KeyUnverifiedError();
  }

  const result: BackfillDecryptionKeysResult = {
    wrapped: 0,
    alreadyProtected: 0,
    keyVerified: preflight.keyVerified,
    suspectRowIds: [],
    deletedRowIds: [],
  };

  for await (const row of eachKeyedRow(client)) {
    if (isProtectedDecryptionKey(row.decryptionKey)) {
      result.alreadyProtected += 1;
      continue;
    }
    if (looksEnvelopeLikeButInvalid(row.decryptionKey)) {
      result.suspectRowIds.push(row.id);
      continue;
    }
    // Re-checked per write: a plaintext row inserted between the preflight
    // and this scan (an old replica still running) must not slip past the
    // unverified-key refusal that gated the run.
    if (!result.keyVerified && !options.force) {
      throw new KeyUnverifiedError();
    }
    try {
      await client.credential.update({
        where: { id: row.id },
        data: { decryptionKey: protectDecryptionKey(row.decryptionKey) },
      });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        result.deletedRowIds.push(row.id);
        continue;
      }
      throw new Error(
        `Failed to wrap the decryption key for credential ${row.id} (${result.wrapped} wrapped before the failure)`,
        { cause: error },
      );
    }
    result.wrapped += 1;
  }

  return result;
}

/**
 * Decrypts every existing envelope (credential keys and service instance
 * configurations) under the active key, throwing on the first failure so
 * nothing is written over a database the key cannot read. Also counts the
 * plaintext rows the wrap pass would change, so the caller can distinguish
 * "nothing to verify against but also nothing to write" from the
 * unverified-write hazard.
 */
async function verifyKeyAgainstAllEnvelopes(
  client: BackfillClient,
): Promise<{ keyVerified: boolean; wrappableRows: number }> {
  let keyVerified = false;
  let wrappableRows = 0;

  for await (const row of eachServiceInstanceRow(client)) {
    // Service instance configurations have no legacy plaintext form: every
    // writer encrypts them before persistence. A config that does not parse
    // as an envelope is corruption, and `force` does not bypass it (force
    // exists for the absence of evidence, not for damaged evidence).
    if (!isProtectedDecryptionKey(row.config)) {
      throw new Error(
        `Service instance ${row.id} holds a configuration that is not a valid encrypted envelope; aborting before any write`,
      );
    }
    decryptOrThrow(row.config, `service instance ${row.id}`);
    keyVerified = true;
  }

  for await (const row of eachKeyedRow(client)) {
    if (isProtectedDecryptionKey(row.decryptionKey)) {
      decryptOrThrow(row.decryptionKey, `credential ${row.id}`);
      keyVerified = true;
    } else if (!looksEnvelopeLikeButInvalid(row.decryptionKey)) {
      wrappableRows += 1;
    }
  }

  return { keyVerified, wrappableRows };
}

function decryptOrThrow(stored: string, rowDescription: string): void {
  try {
    revealDecryptionKey(stored);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new Error(`Preflight decrypt failed for ${rowDescription}; aborting before any write.${detail}`, {
      cause: error,
    });
  }
}

/**
 * Whether an update failed because the row no longer exists. Prisma raises
 * PrismaClientKnownRequestError with code P2025 ("record not found") when a
 * row is deleted between fetch and update; the backfill treats that as a
 * benign race rather than a failure.
 */
function isRecordNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2025';
}

/**
 * Iterates every credential row holding a decryption key, in id order via
 * cursor pagination (`id > cursor`), which does not skip surviving rows when
 * other rows are deleted mid-run.
 */
async function* eachKeyedRow(client: BackfillClient): AsyncGenerator<{ id: string; decryptionKey: string }> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await client.credential.findMany({
      where: { decryptionKey: { not: null }, ...(cursor !== undefined && { id: { gt: cursor } }) },
      select: { id: true, decryptionKey: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
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

/** Iterates every service instance row, in id order via cursor pagination. */
async function* eachServiceInstanceRow(client: BackfillClient): AsyncGenerator<ServiceInstanceConfigRow> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await client.serviceInstance.findMany({
      ...(cursor !== undefined && { where: { id: { gt: cursor } } }),
      select: { id: true, config: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) {
      return;
    }
    cursor = rows[rows.length - 1].id;
    yield* rows;
  }
}
