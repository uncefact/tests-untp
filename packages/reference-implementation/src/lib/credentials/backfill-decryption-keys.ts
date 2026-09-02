import {
  isProtectedDecryptionKey,
  looksEnvelopeLikeButInvalid,
  protectDecryptionKey,
} from './decryption-key-protection';
import { auditEncryption } from './audit-encryption';
import { errorMessage } from './envelope-decrypt';
import { ENVELOPE_STORE_IDS, ENVELOPE_STORE_INFO } from './envelope-stores';
import { prismaEnvelopeStores, type PrismaEnvelopeStoresClient } from './prisma-envelope-stores';
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
  /**
   * Findings in discardable stores the preflight saw and did not block on,
   * each with its remedy, so the operator running this command still hears
   * about them.
   */
  preflightNotes: string[];
};

export type BackfillDecryptionKeysOptions = {
  /**
   * Proceed with wrapping even when no existing envelope validates the
   * active key. Wrapping under a wrong key is unrecoverable, so this is an
   * explicit operator decision, never a default.
   */
  force?: boolean;
  /**
   * Called for each discardable-store finding as the preflight makes it, so
   * the operator sees it even when a later gate refuses the run.
   */
  onPreflightNote?: (note: string) => void;
};

/**
 * The subset of the Prisma client the backfill needs; structural so tests can
 * supply an in-memory fake. The adapter's client for the preflight audit and
 * the row walk, plus the one write the wrap pass makes directly.
 */
export type BackfillClient = PrismaEnvelopeStoresClient & {
  credential: { update(args: { where: { id: string }; data: { decryptionKey: string } }): Promise<unknown> };
};

/**
 * Error thrown when no existing envelope is available to prove the active
 * DATA_ENCRYPTION_KEY and the caller did not pass `force`. Exposed as a class
 * so the CLI can distinguish the refusal from other failures.
 */
export class KeyUnverifiedError extends Error {
  constructor() {
    super(
      'Refusing to wrap plaintext decryption keys: no existing encrypted value in any store ' +
        'is available to prove that ' +
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
 * in every registered store (all encrypted under the same
 * DATA_ENCRYPTION_KEY) via the shared read-only audit. Any decrypt failure,
 * or any value that is not a valid envelope in a store that never holds
 * plaintext, aborts the run naming every
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
  const stores = prismaEnvelopeStores(client);
  const audit = await auditEncryption(stores, getEncryptionService());

  // One aggregated abort naming every blocking row across every store, so a
  // run hitting structural corruption AND decrypt failures reports the full
  // picture rather than the first store only. `force` bypasses neither: a
  // store where plaintext is never written holds only envelopes (so a
  // non-envelope value there is corruption), and force exists for the
  // absence of evidence, not for damaged or undecryptable evidence.
  const blockers: string[] = [];
  const preflightNotes: string[] = [];
  for (const id of ENVELOPE_STORE_IDS) {
    const { rowName, valueName, discardable, remedy } = ENVELOPE_STORE_INFO[id];
    const { corruptedIds, decryptFailedIds } = audit.stores[id];
    if (discardable) {
      // A value the application can lose says nothing about whether the
      // key is right, and this run never touches it.
      const affected = [...corruptedIds, ...decryptFailedIds];
      if (affected.length > 0) {
        const note =
          `${rowName}(s) ${affected.join(', ')} hold a ${valueName} that is damaged or does not open under ` +
          `DATA_ENCRYPTION_KEY; not a blocker for this run and not proof of the key. A rotation clears them, or ${remedy}`;
        preflightNotes.push(note);
        options.onPreflightNote?.(note);
      }
      continue;
    }
    if (corruptedIds.length > 0) {
      blockers.push(
        `Preflight found ${rowName}(s) ${corruptedIds.join(', ')} whose ${valueName} is not a valid encrypted envelope`,
      );
    }
  }
  const decryptFailures = ENVELOPE_STORE_IDS.filter((id) => !ENVELOPE_STORE_INFO[id].discardable).flatMap((id) =>
    audit.stores[id].decryptFailedIds.map((rowId) => `${ENVELOPE_STORE_INFO[id].rowName} ${rowId}`),
  );
  if (decryptFailures.length > 0) {
    blockers.push(`Preflight decrypt failed for ${decryptFailures.join(', ')}`);
  }
  if (blockers.length > 0) {
    const first = audit.firstDecryptFailure;
    const keyNote =
      decryptFailures.length > 0
        ? ' DATA_ENCRYPTION_KEY may not match the key the data was encrypted under.' +
          (first !== undefined ? ` First failure (${first.rowDescription}): ${errorMessage(first.error)}` : '')
        : '';
    throw new Error(`${blockers.join('; and ')}; aborting before any write.${keyNote}`, { cause: first?.error });
  }

  if (!audit.keyVerified && audit.stores.credentials.plaintextCount > 0 && !options.force) {
    throw new KeyUnverifiedError();
  }

  const result: BackfillDecryptionKeysResult = {
    wrapped: 0,
    alreadyProtected: 0,
    keyVerified: audit.keyVerified,
    suspectRowIds: [],
    preflightNotes,
    deletedRowIds: [],
  };

  for await (const row of stores.credentials.rows()) {
    if (isProtectedDecryptionKey(row.value)) {
      result.alreadyProtected += 1;
      continue;
    }
    if (looksEnvelopeLikeButInvalid(row.value)) {
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
        data: { decryptionKey: protectDecryptionKey(row.value) },
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
