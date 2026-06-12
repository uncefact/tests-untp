import { isProtectedDecryptionKey, protectDecryptionKey, revealDecryptionKey } from './decryption-key-protection';

export type BackfillDecryptionKeysResult = {
  wrapped: number;
  alreadyProtected: number;
  /** False when no existing envelope was available to validate the key against. */
  keyVerified: boolean;
};

type CredentialKeyRow = { id: string; decryptionKey: string | null };

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
};

const BATCH_SIZE = 100;

/**
 * Encrypts plaintext credential decryption keys in place. Rows already
 * holding an encrypted envelope are left untouched, so re-running converges
 * to no changes.
 *
 * Before writing anything, validates the active key by decrypting an existing
 * envelope. Wrapping plaintext keys under the wrong key would be
 * unrecoverable (the plaintext is overwritten, and a re-run would count the
 * rows as already protected), so a mismatch aborts the run instead.
 */
export async function backfillDecryptionKeys(client: BackfillClient): Promise<BackfillDecryptionKeysResult> {
  const keyVerified = await verifyKeyAgainstExistingEnvelope(client);

  const result: BackfillDecryptionKeysResult = { wrapped: 0, alreadyProtected: 0, keyVerified };

  for await (const row of eachKeyedRow(client)) {
    if (isProtectedDecryptionKey(row.decryptionKey)) {
      result.alreadyProtected += 1;
      continue;
    }
    try {
      await client.credential.update({
        where: { id: row.id },
        data: { decryptionKey: protectDecryptionKey(row.decryptionKey) },
      });
    } catch (error) {
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
 * Decrypts the first envelope found, proving the active key matches the one
 * the application encrypts with; throws the key-mismatch error otherwise.
 * Returns false when no envelope exists yet to check against.
 */
async function verifyKeyAgainstExistingEnvelope(client: BackfillClient): Promise<boolean> {
  for await (const row of eachKeyedRow(client)) {
    if (isProtectedDecryptionKey(row.decryptionKey)) {
      revealDecryptionKey(row.decryptionKey);
      return true;
    }
  }
  return false;
}

/**
 * Iterates every credential row holding a decryption key, in id order via
 * cursor pagination, which stays consistent if rows are deleted mid-run.
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
