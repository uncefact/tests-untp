import type { IEncryptionService } from '@uncefact/untp-ri-services/encryption';
// Relative imports (not the @/ alias): this module runs inside the Docker
// image via tsx, where no tsconfig.json exists to resolve path aliases.
import { parseEnvelope } from './decryption-key-protection';
import { decryptFailure } from './envelope-decrypt';
import {
  blockingStores,
  classifyNonEnvelope,
  ENVELOPE_STORE_IDS,
  ENVELOPE_STORE_INFO,
  perStore,
  recordNonEnvelope,
  type EnvelopeStoreId,
  type EnvelopeStores,
} from './envelope-stores';
import { reportLines, type Report, type ReportLine } from './operator-report';

/**
 * The outcome for one encrypted store. Id arrays are unbounded and never
 * truncated: the report's contract is every affected row, so memory grows
 * with the number of findings (worst case, every row after a wrong-key
 * deploy).
 */
export type StoreAudit = {
  okCount: number;
  /** Valid envelopes the supplied service failed to decrypt (key mismatch). */
  decryptFailedIds: string[];
  /**
   * Values that are not a valid envelope in a store where plaintext is never
   * legitimate (every writer encrypts before persistence): corruption,
   * whatever the value looks like. Always empty where plaintext is allowed.
   */
  corruptedIds: string[];
  /**
   * Values that look like an envelope without being one (brace-prefixed,
   * unparseable) in a store where plaintext is allowed. Neither decryptable
   * nor plausible legacy plaintext; a backfill run skips them untouched.
   */
  suspectRowIds: string[];
  /**
   * Legacy plaintext values (pre-#697 credential keys) that a backfill run
   * would wrap. A count, not ids: plaintext is expected legacy state there,
   * not a finding.
   */
  plaintextCount: number;
};

export type AuditEncryptionResult = {
  /**
   * True once at least one stored envelope in a store that is not
   * discardable decrypted under the supplied service. False means nothing
   * existed to prove the key: an empty database, all-null credential keys,
   * or plaintext-only credential keys all audit "clean" without
   * demonstrating that the key can decrypt anything. A discardable store
   * never proves the key: a replay body may simply predate a rotation, and
   * proof from it would let a historical key wrap plaintext credential keys
   * irreversibly. Callers gating on the audit (rotation preflight,
   * post-restore checks) must treat false as "unproven", not "verified".
   */
  keyVerified: boolean;
  /**
   * The error thrown by the first failed decrypt in a store that is not
   * discardable, kept so callers that turn the audit into an abort (the
   * backfill preflight) can chain the original diagnostic instead of
   * reporting only the row list. The id arrays remain the complete record;
   * this is one sample for debugging.
   */
  firstDecryptFailure?: { rowDescription: string; error: unknown };
  /** One outcome per registered store, in walk order. */
  stores: Record<EnvelopeStoreId, StoreAudit>;
};

/** Whether the audit found any decrypt failure or corrupted/suspect row. */
export function auditFoundProblems(result: AuditEncryptionResult): boolean {
  return Object.values(result.stores).some(
    (store) => store.decryptFailedIds.length > 0 || store.corruptedIds.length > 0 || store.suspectRowIds.length > 0,
  );
}

/**
 * Attempts to decrypt every stored envelope in every registered
 * encrypted-at-rest store under the supplied encryption service, and reports
 * the outcome per store. Reads only; never writes.
 *
 * The encryption service is a required argument (mirroring
 * validateEncryptionKeyAtStartup) rather than resolved internally: the
 * audit's callers decide which key is being audited. The CLI supplies the
 * active service; a rotation preflight (#720) can supply one built from the
 * outgoing key while the environment already holds the new key.
 *
 * The scan is best-effort under concurrent writes: rows are read in id
 * order with cursor pagination and no transaction, so a row changed after
 * it was scanned, or inserted behind the cursor, is not re-examined. Run
 * with writers quiesced when the result gates a rotation or restore.
 */
export async function auditEncryption(
  stores: EnvelopeStores,
  encryptionService: Pick<IEncryptionService, 'decrypt'>,
): Promise<AuditEncryptionResult> {
  const result: AuditEncryptionResult = {
    keyVerified: false,
    stores: perStore(() => ({
      okCount: 0,
      decryptFailedIds: [],
      corruptedIds: [],
      suspectRowIds: [],
      plaintextCount: 0,
    })),
  };

  for (const id of ENVELOPE_STORE_IDS) {
    const info = ENVELOPE_STORE_INFO[id];
    const outcome = result.stores[id];
    for await (const row of stores[id].rows()) {
      const envelope = parseEnvelope(row.value);
      if (envelope === null) {
        recordNonEnvelope(outcome, classifyNonEnvelope(id, row.value), row.id);
        continue;
      }
      const failure = decryptFailure(encryptionService, envelope);
      if (failure === null) {
        outcome.okCount += 1;
        if (!info.discardable) {
          result.keyVerified = true;
        }
      } else {
        outcome.decryptFailedIds.push(row.id);
        // Kept as the cause of an abort, so only a store whose failure can
        // cause one supplies it.
        if (!info.discardable) {
          result.firstDecryptFailure ??= { rowDescription: `${info.rowName} ${row.id}`, error: failure.error };
        }
      }
    }
  }

  return result;
}

export type AuditReportLine = ReportLine;

export type AuditReport = Report;

/**
 * Renders the audit result as the operator-facing report and exit code, kept
 * separate from the CLI's process wiring so the output contract is testable.
 * Exit 0 covers the nothing-to-verify state (stated explicitly in the
 * report); exit 1 means findings. Operational failures never reach this
 * function; the CLI reports those itself.
 */
export function buildAuditReport(result: AuditEncryptionResult, docsUrl: string): AuditReport {
  const { lines, out, err, ids } = reportLines();

  for (const id of ENVELOPE_STORE_IDS) {
    const info = ENVELOPE_STORE_INFO[id];
    const outcome = result.stores[id];
    out(info.heading);
    out(`  decrypted cleanly: ${outcome.okCount}`);
    ids('failed to decrypt', outcome.decryptFailedIds);
    ids('not a valid encrypted envelope', outcome.corruptedIds);
    ids('corrupted envelope-like (a backfill would skip these untouched)', outcome.suspectRowIds);
    if (info.remedy !== undefined && outcome.decryptFailedIds.length + outcome.corruptedIds.length > 0) {
      err(`  these block nothing and prove nothing about the key; a rotation clears them, or ${info.remedy}`);
    }
  }

  // The backfill wraps native credential keys and nothing else, so its dry
  // run counts that store alone, whatever other store might one day allow
  // plaintext.
  const wrappablePlaintextCount = result.stores.credentials.plaintextCount;
  // Only a store that can prove the key can disprove it; a discardable
  // store's failures say nothing either way.
  const anyDecryptFailed = ENVELOPE_STORE_IDS.some(
    (id) => !ENVELOPE_STORE_INFO[id].discardable && result.stores[id].decryptFailedIds.length > 0,
  );

  // The dry run mirrors the backfill's own gate order: hard-abort buckets
  // first (which --force never bypasses), then the unverified-key force
  // gate, then the wrap. Deciding from the wrappable count alone would
  // offer --force in states where the backfill aborts regardless of it. A
  // discardable store's failures are reported above and block nothing.
  const wouldHardAbort =
    blockingStores((id) => result.stores[id].decryptFailedIds.length > 0 || result.stores[id].corruptedIds.length > 0)
      .length > 0;
  if (wouldHardAbort) {
    out(
      'Dry run: a backfill:decryption-keys run would abort before any write until the reported failures are resolved' +
        (wrappablePlaintextCount > 0 ? `; ${wrappablePlaintextCount} plaintext key(s) are otherwise wrappable.` : '.'),
    );
  } else if (wrappablePlaintextCount > 0) {
    out(
      `Dry run: a backfill:decryption-keys run would wrap ${wrappablePlaintextCount} plaintext key(s)` +
        (result.keyVerified
          ? '.'
          : ', but would refuse without --force because no envelope proves DATA_ENCRYPTION_KEY.'),
    );
  }

  // "Nothing to verify" means no valid envelope was encountered at all. A
  // wrong key also leaves keyVerified false, but there the decrypt failures
  // are the story and this note would misleadingly suggest an empty store.
  if (!result.keyVerified && !anyDecryptFailed) {
    out(
      auditFoundProblems(result)
        ? 'Note: nothing existed to verify the active DATA_ENCRYPTION_KEY against; the findings above ' +
            'prove nothing about the key either way, and the key itself remains unproven.'
        : 'Note: nothing existed to verify the active DATA_ENCRYPTION_KEY against; a clean result here does not ' +
            'prove the key can decrypt anything.',
    );
  }

  if (auditFoundProblems(result)) {
    err(`Audit found problems. Nothing was modified. See ${docsUrl}`);
    return { lines, exitCode: 1 };
  }
  out('Audit complete: all stored envelopes decrypted cleanly. Nothing was modified.');
  return { lines, exitCode: 0 };
}
