import {
  isProtectedDecryptionKey,
  looksEnvelopeLikeButInvalid,
  protectDecryptionKey,
} from './decryption-key-protection';
import { auditEncryption } from './audit-encryption';
import { eachKeyedCredentialRow, type EnvelopeStoresClient } from './envelope-stores';
import { getEncryptionService } from '../encryption/encryption';

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

/**
 * The subset of the Prisma client the backfill needs; structural so tests can
 * supply an in-memory fake. Shared with the read-only audit
 * (audit-encryption.ts), which walks the same stores.
 */
export type BackfillClient = EnvelopeStoresClient;

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
 * Before writing anything, the preflight audits every existing envelope
 * (all service instance configurations and all protected credential keys,
 * both encrypted under the same DATA_ENCRYPTION_KEY) via the shared
 * read-only audit. Any decrypt failure, or any service instance
 * configuration that is not a valid envelope, aborts the run naming every
 * affected row; `force` bypasses neither (force exists for the absence of
 * evidence, not for damaged or undecryptable evidence). Wrapping plaintext
 * under a wrong key would be unrecoverable (the plaintext is overwritten,
 * and a re-run would count the rows as already protected). Credential rows
 * whose value merely resembles a corrupted envelope are reported and
 * skipped while other plaintext rows still wrap. When no envelope exists
 * anywhere and there is plaintext to wrap, the run refuses unless `force`
 * is passed.
 */
export async function backfillDecryptionKeys(
  client: BackfillClient,
  options: BackfillDecryptionKeysOptions = {},
): Promise<BackfillDecryptionKeysResult> {
  const audit = await auditEncryption(client, getEncryptionService());

  // One aggregated abort naming every blocking row across both buckets, so a
  // run hitting structural corruption AND decrypt failures reports the full
  // picture rather than the first bucket only. `force` bypasses neither:
  // service instance configurations have no legacy plaintext form (every
  // writer encrypts them before persistence, so a non-envelope config is
  // corruption), and force exists for the absence of evidence, not for
  // damaged or undecryptable evidence.
  const blockers: string[] = [];
  if (audit.serviceInstances.corruptedIds.length > 0) {
    blockers.push(
      `Service instance(s) ${audit.serviceInstances.corruptedIds.join(', ')} hold configurations that are ` +
        'not valid encrypted envelopes',
    );
  }
  const decryptFailures = [
    ...audit.serviceInstances.decryptFailedIds.map((id) => `service instance ${id}`),
    ...audit.credentials.decryptFailedIds.map((id) => `credential ${id}`),
  ];
  if (decryptFailures.length > 0) {
    blockers.push(`Preflight decrypt failed for ${decryptFailures.join(', ')}`);
  }
  if (blockers.length > 0) {
    const first = audit.firstDecryptFailure;
    // Duck-typed rather than `instanceof Error`: the error is thrown by the
    // built services package, whose Error identity can differ from this
    // module's realm (it does under jest), which would silently drop the detail.
    const firstMessage =
      first !== undefined && typeof (first.error as { message?: unknown } | null)?.message === 'string'
        ? (first.error as { message: string }).message
        : undefined;
    const keyNote =
      decryptFailures.length > 0
        ? ' DATA_ENCRYPTION_KEY may not match the key the data was encrypted under.' +
          (firstMessage !== undefined ? ` First failure (${first?.rowDescription}): ${firstMessage}` : '')
        : '';
    throw new Error(`${blockers.join('; and ')}; aborting before any write.${keyNote}`, { cause: first?.error });
  }

  if (!audit.keyVerified && audit.credentials.wrappablePlaintextCount > 0 && !options.force) {
    throw new KeyUnverifiedError();
  }

  const result: BackfillDecryptionKeysResult = {
    wrapped: 0,
    alreadyProtected: 0,
    keyVerified: audit.keyVerified,
    suspectRowIds: [],
    deletedRowIds: [],
  };

  for await (const row of eachKeyedCredentialRow(client)) {
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
 * Whether an update failed because the row no longer exists. Prisma raises
 * PrismaClientKnownRequestError with code P2025 ("record not found") when a
 * row is deleted between fetch and update; the backfill treats that as a
 * benign race rather than a failure.
 */
function isRecordNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2025';
}
