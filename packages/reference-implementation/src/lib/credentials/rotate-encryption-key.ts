import type { EncryptedEnvelope, IEncryptionService } from '@uncefact/untp-ri-services/encryption';
import { AesGcmEncryptionAdapter } from '@uncefact/untp-ri-services/encryption';
import type { LoggerService } from '@uncefact/untp-ri-services/logging';
// Relative imports (not the @/ alias): this module runs inside the Docker
// image via tsx, where no tsconfig.json exists to resolve path aliases.
import { parseEnvelope } from './decryption-key-protection';
import { decryptFailure, errorMessage } from './envelope-decrypt';
import { assertNotPlaceholderEncryptionKey, PLACEHOLDER_ENCRYPTION_KEY } from './validate-encryption-key-startup';
import {
  blockingStores,
  classifyNonEnvelope,
  ENVELOPE_STORE_IDS,
  ENVELOPE_STORE_INFO,
  perStore,
  recordNonEnvelope,
  type EnvelopeStore,
  type EnvelopeStoreId,
  type EnvelopeStores,
} from './envelope-stores';
import { reportLines, type Report, type ReportLine } from './operator-report';

/**
 * The services the rotation runs under, both injected so the library never
 * resolves keys from the environment: the caller decides which key is
 * active and which is outgoing. The CLI builds both adapters directly from
 * DATA_ENCRYPTION_KEY and OUTGOING_DATA_ENCRYPTION_KEY; it deliberately
 * avoids getEncryptionService(), whose resolver rejects a stale
 * SERVICE_ENCRYPTION_KEY alias that a rotation environment legitimately
 * still carries.
 */
export type RotationServices = {
  activeService: IEncryptionService;
  outgoingService: Pick<IEncryptionService, 'decrypt'>;
};

/** Per-store outcome. Id arrays are unbounded and never truncated. */
export type RotationStoreResult = {
  /** Rows whose envelope already decrypted under the active key; untouched. */
  alreadyActive: number;
  /**
   * Rows whose envelope opened only under the outgoing key at
   * classification time (rotation candidates), whatever later became of
   * them in the write pass. The report's reversed-keys and
   * nothing-to-verify readouts derive from this, not from write outcomes.
   */
  outgoingOpened: number;
  /** Rows re-encrypted under the active key by this run. */
  rotated: number;
  /** Valid envelopes that decrypted under neither supplied key; blockers. */
  neitherKeyIds: string[];
  /** Rows deleted between classification and write. */
  deletedIds: string[];
  /** Rows found already rotated by the time the write ran (another run completed them). */
  concurrentlyCompletedIds: string[];
  /**
   * Rows whose stored value changed between classification and write into
   * something this run must not touch. Never overwritten.
   */
  conflictIds: string[];
  /**
   * Non-envelope values in a store where plaintext is never written, so
   * they are corruption; blockers. Always empty where plaintext is allowed.
   */
  corruptedIds: string[];
  /**
   * Rows in a discardable store whose value was not an envelope or opened
   * under neither key, cleared by this run: the value is gone, the row
   * stays. Such rows also appear in `corruptedIds` or `neitherKeyIds`, which
   * record what was found; this records what was done about it.
   */
  clearedIds: string[];
  /** Brace-prefixed unparseable values in a store where plaintext is allowed; skipped untouched, reported. */
  suspectRowIds: string[];
  /** Legacy plaintext values; the backfill owns wrapping them, the rotation never touches them. */
  plaintextCount: number;
};

export type RotateEncryptionKeyResult = {
  /**
   * True when blockers (neither-key envelopes, corrupted values in a store
   * that never holds plaintext) stopped the run before any write. A
   * discardable store's rows never block: they are cleared instead.
   */
  blocked: boolean;
  /** One outcome per registered store, in walk order. */
  stores: Record<EnvelopeStoreId, RotationStoreResult>;
  /**
   * Both keys' errors from the first neither-key row. The id lists are the
   * record; this is one debugging sample. The errors are deliberately not
   * labelled a key mismatch: AES-GCM throws the identical error for a wrong
   * key and for tampered ciphertext or tag.
   */
  firstNeitherDecrypt?: { rowDescription: string; activeError: unknown; outgoingError: unknown };
};

type Candidate = {
  store: EnvelopeStoreId;
  id: string;
  stored: string;
  envelope: EncryptedEnvelope;
};

/** A discardable store's row this run will clear: what was stored, so the clear is compare-and-swap too. */
type Discard = { store: EnvelopeStoreId; id: string; stored: string };

/**
 * The classification counts per store, printed by the CLI before the first
 * write.
 */
export type RotationPreflightSummary = Record<
  EnvelopeStoreId,
  {
    alreadyActive: number;
    outgoingOpened: number;
    corrupted: number;
    suspects: number;
    plaintext: number;
    /** Discardable rows this run will clear: not an envelope, or opened under neither key. */
    toClear: number;
  }
>;

export type RotateEncryptionKeyOptions = {
  /**
   * Called exactly once, synchronously, after classification completes and
   * before the first write, and only when the run is not blocked (a blocked
   * run returns immediately and the report speaks once). Lets the CLI print
   * the preflight counts before writing, so a mid-run failure still leaves
   * the operator the classification readout.
   */
  onPreflight?: (summary: RotationPreflightSummary) => void;
};

/**
 * Re-encrypts every stored envelope that opens under the outgoing key so it
 * opens under the active key instead.
 *
 * Two phases. A full classification pass first walks every registered
 * store, parsing each stored value once and trying the active service
 * before the outgoing one on that same value; any valid envelope neither
 * key opens, or any non-envelope value in a store that never holds
 * plaintext, blocks the run before a single write (`blocked: true`), unless
 * the store is discardable, in which case the row is cleared in the write
 * pass (compare-and-swap, the row stays) rather than left holding material
 * under a key that may be compromised. Only a
 * blocker-free classification proceeds to the write pass, which re-encrypts
 * each candidate preserving its envelope's algorithm and writes via
 * compare-and-swap; a miss is re-read and classified (deleted, concurrently
 * completed, changed-and-still-rotatable which is retried once against the
 * fresh value, or a conflict left untouched).
 *
 * Idempotent: a re-run finds rows already under the active key and writes
 * nothing; a re-run after a mid-run crash rotates only the remainder.
 *
 * The scan is best-effort under concurrent writes; the documented procedure
 * requires every writer stopped for the rotation window. Compare-and-swap
 * is the backstop for the writer that was missed, not a licence to rotate a
 * live system.
 */
export async function rotateEncryptionKey(
  stores: EnvelopeStores,
  services: RotationServices,
  options: RotateEncryptionKeyOptions = {},
): Promise<RotateEncryptionKeyResult> {
  const result: RotateEncryptionKeyResult = {
    blocked: false,
    stores: perStore(() => ({
      alreadyActive: 0,
      outgoingOpened: 0,
      rotated: 0,
      neitherKeyIds: [],
      deletedIds: [],
      concurrentlyCompletedIds: [],
      conflictIds: [],
      corruptedIds: [],
      clearedIds: [],
      suspectRowIds: [],
      plaintextCount: 0,
    })),
  };
  const candidates: Candidate[] = [];
  const discards: Discard[] = [];

  for (const id of ENVELOPE_STORE_IDS) {
    const bucket = result.stores[id];
    const { discardable } = ENVELOPE_STORE_INFO[id];
    for await (const row of stores[id].rows()) {
      const envelope = parseEnvelope(row.value);
      if (envelope === null) {
        const kind = classifyNonEnvelope(id, row.value);
        recordNonEnvelope(bucket, kind, row.id);
        if (discardable && kind === 'corrupted') {
          discards.push({ store: id, id: row.id, stored: row.value });
        }
        continue;
      }
      const opened = classify(result, candidates, services, { store: id, id: row.id, stored: row.value, envelope });
      if (discardable && !opened) {
        discards.push({ store: id, id: row.id, stored: row.value });
      }
    }
  }

  const blocked =
    blockingStores((id) => result.stores[id].corruptedIds.length > 0 || result.stores[id].neitherKeyIds.length > 0)
      .length > 0;
  if (blocked) {
    result.blocked = true;
    return result;
  }

  options.onPreflight?.(
    perStore((id) => {
      const bucket = result.stores[id];
      return {
        alreadyActive: bucket.alreadyActive,
        outgoingOpened: bucket.outgoingOpened,
        corrupted: bucket.corruptedIds.length,
        suspects: bucket.suspectRowIds.length,
        plaintext: bucket.plaintextCount,
        toClear: discards.filter((discard) => discard.store === id).length,
      };
    }),
  );

  for (const candidate of candidates) {
    try {
      await rotateCandidate(services, stores[candidate.store], candidate, result.stores[candidate.store]);
    } catch (error) {
      // Commit-safe wording: the failing write itself may or may not have
      // committed, so state only what was confirmed, never the exact key
      // mixture of the store.
      const rotatedSoFar = Object.values(result.stores).reduce((sum, outcome) => sum + outcome.rotated, 0);
      const stateNote =
        rotatedSoFar > 0
          ? `${rotatedSoFar} write(s) confirmed before the failure`
          : 'no write had been confirmed before the failure';
      throw new Error(
        `Failed to rotate ${ENVELOPE_STORE_INFO[candidate.store].rowName} ${candidate.id} (${stateNote}). ` +
          'The rotation may be incomplete: keep ' +
          'writers stopped and re-run with the same key pair; the run converges.',
        { cause: error },
      );
    }
  }

  for (const discard of discards) {
    const bucket = result.stores[discard.store];
    try {
      await clearDiscard(stores[discard.store], discard, bucket);
    } catch (error) {
      throw new Error(
        `Failed to clear ${ENVELOPE_STORE_INFO[discard.store].rowName} ${discard.id}. The rotation may be ` +
          'incomplete: keep writers stopped and re-run with the same key pair; the run converges.',
        { cause: error },
      );
    }
  }

  return result;
}

/** Records the row's outcome; true when the envelope opened under one of the two keys. */
function classify(
  result: RotateEncryptionKeyResult,
  candidates: Candidate[],
  services: RotationServices,
  row: Candidate,
): boolean {
  const bucket = result.stores[row.store];
  const activeFailure = decryptFailure(services.activeService, row.envelope);
  if (activeFailure === null) {
    bucket.alreadyActive += 1;
    return true;
  }
  const outgoingFailure = decryptFailure(services.outgoingService, row.envelope);
  if (outgoingFailure === null) {
    bucket.outgoingOpened += 1;
    candidates.push(row);
    return true;
  }
  bucket.neitherKeyIds.push(row.id);
  result.firstNeitherDecrypt ??= {
    rowDescription: `${ENVELOPE_STORE_INFO[row.store].rowName} ${row.id}`,
    activeError: activeFailure.error,
    outgoingError: outgoingFailure.error,
  };
  return false;
}

/**
 * Clears a discardable row's unreadable value by compare-and-swap. A miss
 * is re-read: a row already gone is a deletion, one already cleared counts
 * as cleared, and one holding a different value is a conflict left alone.
 */
async function clearDiscard(store: EnvelopeStore, discard: Discard, bucket: RotationStoreResult): Promise<void> {
  if (await store.discard(discard.id, discard.stored)) {
    bucket.clearedIds.push(discard.id);
    return;
  }
  const current = await store.readCurrent(discard.id);
  if (current.kind === 'missing') {
    bucket.deletedIds.push(discard.id);
  } else if (current.kind === 'cleared') {
    bucket.clearedIds.push(discard.id);
  } else {
    bucket.conflictIds.push(discard.id);
  }
}

async function rotateCandidate(
  services: RotationServices,
  store: EnvelopeStore,
  candidate: Candidate,
  bucket: RotationStoreResult,
): Promise<void> {
  const written = await casWrite(services, store, candidate);
  if (written) {
    bucket.rotated += 1;
    return;
  }

  // The compare-and-swap missed: the row is gone or its value changed after
  // classification. Re-read and decide from the current value; never write
  // over a value this run has not examined.
  const current = await store.readCurrent(candidate.id);
  if (current.kind === 'missing') {
    bucket.deletedIds.push(candidate.id);
    return;
  }
  if (current.kind === 'cleared') {
    // The row still exists but its value was cleared: a changed value this
    // run must not touch, not a deletion.
    bucket.conflictIds.push(candidate.id);
    return;
  }
  const envelope = parseEnvelope(current.value);
  if (envelope !== null && decryptFailure(services.activeService, envelope) === null) {
    bucket.concurrentlyCompletedIds.push(candidate.id);
    return;
  }
  if (envelope !== null && decryptFailure(services.outgoingService, envelope) === null) {
    // Still rotatable, just re-written meanwhile (an old replica). One
    // retry against the fresh value; a second miss is a conflict.
    const retried = await casWrite(services, store, { ...candidate, stored: current.value, envelope });
    if (retried) {
      bucket.rotated += 1;
      return;
    }
  }
  bucket.conflictIds.push(candidate.id);
}

/** True when the conditional write landed on exactly the expected value. */
async function casWrite(services: RotationServices, store: EnvelopeStore, candidate: Candidate): Promise<boolean> {
  const plaintext = services.outgoingService.decrypt(candidate.envelope);
  // Preserve the envelope's algorithm: rotation is a key-only operation,
  // never an implicit algorithm migration.
  const rotated = JSON.stringify(services.activeService.encrypt(plaintext, candidate.envelope.type));
  return store.casWrite(candidate.id, candidate.stored, rotated);
}

export type RotationKeyValidation =
  | { ok: true; services: RotationServices; warnings: string[] }
  | { ok: false; error: string };

/**
 * Validates the rotation's key pair and builds both adapters, entirely
 * without database access, so the whole gate is testable and provably runs
 * before the first query. Order: named missing-variable errors, the
 * adapters' own 64-hex format rule, the placeholder policy on the active
 * key (same environment-conditional rule as startup and the seed), then
 * warnings that never block: a placeholder outgoing key (rotating off the
 * published value is the remediation this command exists for) and
 * byte-identical keys (hex is case-insensitive, so the strings can differ
 * while the keys do not).
 *
 * Deliberately reads the two variables directly rather than through
 * resolveDataEncryptionKey: that resolver rejects a SERVICE_ENCRYPTION_KEY
 * alias differing from DATA_ENCRYPTION_KEY, and a rotation environment
 * legitimately still carries the stale alias. The alias check remains in
 * force for application startup.
 */
export function validateRotationKeys(
  env: Record<string, string | undefined>,
  logger: LoggerService,
): RotationKeyValidation {
  const activeKey = env.DATA_ENCRYPTION_KEY;
  const outgoingKey = env.OUTGOING_DATA_ENCRYPTION_KEY;
  if (!activeKey) {
    return { ok: false, error: 'DATA_ENCRYPTION_KEY (the new key) is not set.' };
  }
  if (!outgoingKey) {
    return { ok: false, error: 'OUTGOING_DATA_ENCRYPTION_KEY (the previous key) is not set.' };
  }

  let activeService: AesGcmEncryptionAdapter;
  let outgoingService: AesGcmEncryptionAdapter;
  try {
    activeService = new AesGcmEncryptionAdapter(activeKey, logger);
  } catch (error) {
    return { ok: false, error: `DATA_ENCRYPTION_KEY (the new key) is invalid: ${errorMessage(error)}` };
  }
  try {
    outgoingService = new AesGcmEncryptionAdapter(outgoingKey, logger);
  } catch (error) {
    return { ok: false, error: `OUTGOING_DATA_ENCRYPTION_KEY (the previous key) is invalid: ${errorMessage(error)}` };
  }

  try {
    assertNotPlaceholderEncryptionKey(activeKey, { deploymentEnvironment: env.DEPLOYMENT_ENVIRONMENT });
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }

  const warnings: string[] = [];
  if (activeKey === PLACEHOLDER_ENCRYPTION_KEY) {
    // Reached only when the policy allowed it (local development); surface
    // it on the CLI channel too, not only the module logger.
    warnings.push(
      'DATA_ENCRYPTION_KEY is the placeholder value from .env.example; acceptable in local development only.',
    );
  }
  if (outgoingKey === PLACEHOLDER_ENCRYPTION_KEY) {
    warnings.push(
      'OUTGOING_DATA_ENCRYPTION_KEY is the placeholder value published in .env.example. Everything ' +
        'encrypted under it should be treated as exposed; rotating it to a private key is the right move.',
    );
  }
  if (Buffer.from(activeKey, 'hex').equals(Buffer.from(outgoingKey, 'hex'))) {
    warnings.push(
      'The active and outgoing keys are identical; this run can only verify that every envelope opens ' +
        'under that key. Nothing will be rotated.',
    );
  }
  return { ok: true, services: { activeService, outgoingService }, warnings };
}

export type RotationReportLine = ReportLine;

export type RotationReport = Report;

/**
 * Renders the rotation result as the operator-facing report and exit code,
 * separate from the CLI's process wiring so the output contract is
 * testable. Exit 0 only when every valid envelope ended under the active
 * key with nothing skipped as suspect or lost to a conflict or delete;
 * plaintext leftovers alone stay exit 0 (wrapping them is the backfill's
 * job). Operational failures never reach this function.
 */
export function buildRotationReport(result: RotateEncryptionKeyResult, docsUrl: string): RotationReport {
  const { lines, out, err, ids } = reportLines();

  for (const id of ENVELOPE_STORE_IDS) {
    const info = ENVELOPE_STORE_INFO[id];
    const outcome = result.stores[id];
    out(info.heading);
    out(`  already under the active key: ${outcome.alreadyActive}`);
    out(`  opened only under the outgoing key: ${outcome.outgoingOpened}`);
    out(`  rotated from the outgoing key: ${outcome.rotated}`);
    ids('decrypted under neither supplied key', outcome.neitherKeyIds);
    ids('not a valid encrypted envelope', outcome.corruptedIds);
    ids('cleared, the rows kept', outcome.clearedIds);
    if (
      info.remedy !== undefined &&
      outcome.neitherKeyIds.length + outcome.corruptedIds.length > outcome.clearedIds.length
    ) {
      err(`  some could not be cleared this run; ${info.remedy}`);
    }
    ids('corrupted envelope-like, left untouched', outcome.suspectRowIds);
    if (outcome.plaintextCount > 0) {
      out(
        `  legacy plaintext ${info.valueName}s, left untouched: ${outcome.plaintextCount} ` +
          '(wrap them with backfill:decryption-keys under the new key)',
      );
    }
    ids('deleted between scan and write', outcome.deletedIds);
    ids('already rotated by a concurrent run', outcome.concurrentlyCompletedIds);
    ids('changed during the run, left untouched', outcome.conflictIds);
  }

  if (result.firstNeitherDecrypt !== undefined) {
    const { rowDescription, activeError, outgoingError } = result.firstNeitherDecrypt;
    err(
      `First such row (${rowDescription}): active key error "${errorMessage(activeError)}"; ` +
        `outgoing key error "${errorMessage(outgoingError)}". This is what a third key and tampered ` +
        'data both look like; the errors do not distinguish them.',
    );
  }

  if (result.blocked) {
    err(`Rotation aborted before any write; resolve the rows above and re-run. See ${docsUrl}`);
    return { lines, exitCode: 1 };
  }

  // The reversed-keys and nothing-to-verify readouts derive from
  // classification counts, not write outcomes, so concurrent completions
  // and conflicts cannot masquerade as "the outgoing key opened nothing".
  const totals = Object.values(result.stores);
  const anyEnvelope = totals.some((store) => store.alreadyActive + store.outgoingOpened > 0);
  const outgoingOpenedTotal = totals.reduce((sum, store) => sum + store.outgoingOpened, 0);

  // A discardable store's unreadable rows did not block the run; those the
  // run cleared are settled, and any it could not clear leave it incomplete.
  const incomplete = totals.some(
    (store) =>
      store.suspectRowIds.length +
        store.deletedIds.length +
        store.conflictIds.length +
        (store.neitherKeyIds.length + store.corruptedIds.length - store.clearedIds.length) >
      0,
  );

  const clearedTotal = totals.reduce((sum, store) => sum + store.clearedIds.length, 0);
  if (!anyEnvelope) {
    out(
      'Note: no stored envelope opened under either supplied key (empty or plaintext-only stores); ' +
        'there was nothing to rotate and neither key was proven.',
    );
    if (incomplete) {
      err(`Run finished incomplete; inspect the rows above. See ${docsUrl}`);
      return { lines, exitCode: 1 };
    }
    out(
      clearedTotal > 0 ? `Nothing was rotated; ${clearedTotal} unreadable value(s) cleared.` : 'Nothing was modified.',
    );
    return { lines, exitCode: 0 };
  }

  if (outgoingOpenedTotal === 0) {
    out(
      'The outgoing key opened nothing; every envelope already opens under the active key. ' +
        (clearedTotal > 0
          ? `Nothing was rotated; ${clearedTotal} unreadable value(s) cleared. `
          : 'Nothing was rotated. ') +
        'If a rotation was expected, check the two variables are not reversed.',
    );
    if (incomplete) {
      err(`Run finished incomplete; inspect the rows above. See ${docsUrl}`);
      return { lines, exitCode: 1 };
    }
    return { lines, exitCode: 0 };
  }

  if (incomplete) {
    err(`Rotation finished incomplete; inspect the rows above. See ${docsUrl}`);
    return { lines, exitCode: 1 };
  }
  out('Rotation complete: every stored envelope opens under the active key.');
  return { lines, exitCode: 0 };
}
