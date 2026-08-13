import type { IEncryptionService } from '@uncefact/untp-ri-services/encryption';
// Relative imports (not the @/ alias): this module runs inside the Docker
// image via tsx, where no tsconfig.json exists to resolve path aliases.
import { looksEnvelopeLikeButInvalid, parseEnvelope } from './decryption-key-protection';
import { eachKeyedCredentialRow, eachServiceInstanceRow, type EnvelopeStoresClient } from './envelope-stores';

/**
 * Per-store outcome of the read-only encryption audit. Id arrays are
 * unbounded and never truncated: the report's contract is every affected
 * row, so memory grows with the number of findings (worst case, every row
 * after a wrong-key deploy).
 */
export type AuditEncryptionResult = {
  /**
   * True once at least one stored envelope decrypted under the supplied
   * service. False means nothing existed to prove the key: an empty
   * database, all-null credential keys, or plaintext-only credential keys
   * all audit "clean" without demonstrating that the key can decrypt
   * anything. Callers gating on the audit (rotation preflight, post-restore
   * checks) must treat false as "unproven", not "verified".
   */
  keyVerified: boolean;
  /**
   * The error thrown by the first failed decrypt, kept so callers that turn
   * the audit into an abort (the backfill preflight) can chain the original
   * diagnostic instead of reporting only the row list. The id arrays remain
   * the complete record; this is one sample for debugging.
   */
  firstDecryptFailure?: { rowDescription: string; error: unknown };
  serviceInstances: {
    okCount: number;
    /** Valid envelopes the supplied service failed to decrypt (key mismatch). */
    decryptFailedIds: string[];
    /**
     * Rows whose config is not a valid envelope at all. Service instance
     * configurations have no plaintext form (every writer encrypts before
     * persistence), so any non-envelope value is corruption, whatever it
     * looks like. This is deliberately stricter than the credential store's
     * envelope-like test, and stricter than the startup validator, which
     * skips such rows while sampling for one good envelope.
     */
    corruptedIds: string[];
  };
  credentials: {
    okCount: number;
    /** Valid envelopes the supplied service failed to decrypt (key mismatch). */
    decryptFailedIds: string[];
    /**
     * Rows that look like an envelope without being one (brace-prefixed,
     * unparseable). Neither decryptable nor plausible legacy plaintext; a
     * backfill run skips them untouched.
     */
    suspectRowIds: string[];
    /**
     * Legacy plaintext keys (pre-#697 rows) that a backfill run would wrap.
     * A count, not ids: plaintext is expected legacy state, not a finding.
     */
    wrappablePlaintextCount: number;
  };
};

/** Whether the audit found any decrypt failure or corrupted/suspect row. */
export function auditFoundProblems(result: AuditEncryptionResult): boolean {
  return (
    result.serviceInstances.decryptFailedIds.length > 0 ||
    result.serviceInstances.corruptedIds.length > 0 ||
    result.credentials.decryptFailedIds.length > 0 ||
    result.credentials.suspectRowIds.length > 0
  );
}

/**
 * Attempts to decrypt every stored envelope in both encrypted-at-rest stores
 * (service instance configurations, credential decryption keys) under the
 * supplied encryption service, and reports the outcome per store. Reads
 * only; never writes.
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
  client: EnvelopeStoresClient,
  encryptionService: Pick<IEncryptionService, 'decrypt'>,
): Promise<AuditEncryptionResult> {
  const result: AuditEncryptionResult = {
    keyVerified: false,
    serviceInstances: { okCount: 0, decryptFailedIds: [], corruptedIds: [] },
    credentials: { okCount: 0, decryptFailedIds: [], suspectRowIds: [], wrappablePlaintextCount: 0 },
  };

  for await (const row of eachServiceInstanceRow(client)) {
    const envelope = parseEnvelope(row.config);
    if (envelope === null) {
      result.serviceInstances.corruptedIds.push(row.id);
      continue;
    }
    const failure = decryptFailure(encryptionService, envelope);
    if (failure === null) {
      result.serviceInstances.okCount += 1;
      result.keyVerified = true;
    } else {
      result.serviceInstances.decryptFailedIds.push(row.id);
      result.firstDecryptFailure ??= { rowDescription: `service instance ${row.id}`, error: failure.error };
    }
  }

  for await (const row of eachKeyedCredentialRow(client)) {
    const envelope = parseEnvelope(row.decryptionKey);
    if (envelope !== null) {
      const failure = decryptFailure(encryptionService, envelope);
      if (failure === null) {
        result.credentials.okCount += 1;
        result.keyVerified = true;
      } else {
        result.credentials.decryptFailedIds.push(row.id);
        result.firstDecryptFailure ??= { rowDescription: `credential ${row.id}`, error: failure.error };
      }
      continue;
    }
    if (looksEnvelopeLikeButInvalid(row.decryptionKey)) {
      result.credentials.suspectRowIds.push(row.id);
    } else {
      result.credentials.wrappablePlaintextCount += 1;
    }
  }

  return result;
}

/** One line of the operator-facing audit report, tagged with its stream. */
export type AuditReportLine = { text: string; stream: 'out' | 'err' };

export type AuditReport = { lines: AuditReportLine[]; exitCode: 0 | 1 };

/**
 * Renders the audit result as the operator-facing report and exit code, kept
 * separate from the CLI's process wiring so the output contract is testable.
 * Exit 0 covers the nothing-to-verify state (stated explicitly in the
 * report); exit 1 means findings. Operational failures never reach this
 * function; the CLI reports those itself.
 */
export function buildAuditReport(result: AuditEncryptionResult, docsUrl: string): AuditReport {
  const { serviceInstances, credentials } = result;
  const lines: AuditReportLine[] = [];
  const out = (text: string) => lines.push({ text, stream: 'out' });
  const err = (text: string) => lines.push({ text, stream: 'err' });
  const ids = (label: string, rowIds: string[]) => {
    if (rowIds.length > 0) {
      err(`  ${label} (${rowIds.length}): ${rowIds.join(', ')}`);
    }
  };

  out('Service instance configurations:');
  out(`  decrypted cleanly: ${serviceInstances.okCount}`);
  ids('failed to decrypt', serviceInstances.decryptFailedIds);
  ids('not a valid encrypted envelope', serviceInstances.corruptedIds);

  out('Credential decryption keys:');
  out(`  decrypted cleanly: ${credentials.okCount}`);
  ids('failed to decrypt', credentials.decryptFailedIds);
  ids('corrupted envelope-like (a backfill would skip these untouched)', credentials.suspectRowIds);

  // The dry run mirrors the backfill's own gate order: hard-abort buckets
  // first (which --force never bypasses), then the unverified-key force
  // gate, then the wrap. Deciding from the wrappable count alone would
  // offer --force in states where the backfill aborts regardless of it.
  const wouldHardAbort =
    serviceInstances.corruptedIds.length > 0 ||
    serviceInstances.decryptFailedIds.length > 0 ||
    credentials.decryptFailedIds.length > 0;
  if (wouldHardAbort) {
    out(
      'Dry run: a backfill:decryption-keys run would abort before any write until the reported failures are resolved' +
        (credentials.wrappablePlaintextCount > 0
          ? `; ${credentials.wrappablePlaintextCount} plaintext key(s) are otherwise wrappable.`
          : '.'),
    );
  } else if (credentials.wrappablePlaintextCount > 0) {
    out(
      `Dry run: a backfill:decryption-keys run would wrap ${credentials.wrappablePlaintextCount} plaintext key(s)` +
        (result.keyVerified
          ? '.'
          : ', but would refuse without --force because no envelope proves DATA_ENCRYPTION_KEY.'),
    );
  }

  // "Nothing to verify" means no valid envelope was encountered at all. A
  // wrong key also leaves keyVerified false, but there the decrypt failures
  // are the story and this note would misleadingly suggest an empty store.
  const anyEnvelopeExamined =
    result.keyVerified || serviceInstances.decryptFailedIds.length > 0 || credentials.decryptFailedIds.length > 0;
  if (!anyEnvelopeExamined) {
    out(
      auditFoundProblems(result)
        ? 'Note: nothing existed to verify the active DATA_ENCRYPTION_KEY against; the findings above are ' +
            'structural, and the key itself remains unproven.'
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

/** Null on success; the thrown error (wrapped, so a thrown falsy still registers) on failure. */
function decryptFailure(
  encryptionService: Pick<IEncryptionService, 'decrypt'>,
  envelope: Parameters<IEncryptionService['decrypt']>[0],
): { error: unknown } | null {
  try {
    encryptionService.decrypt(envelope);
    return null;
  } catch (error) {
    return { error };
  }
}
