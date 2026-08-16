import type { EncryptedEnvelope, IEncryptionService } from '@uncefact/untp-ri-services/encryption';
import { AesGcmEncryptionAdapter } from '@uncefact/untp-ri-services/encryption';
import type { LoggerService } from '@uncefact/untp-ri-services/logging';
// Relative imports (not the @/ alias): this module runs inside the Docker
// image via tsx, where no tsconfig.json exists to resolve path aliases.
import { parseEnvelope } from './decryption-key-protection';
import { assertNotPlaceholderEncryptionKey, PLACEHOLDER_ENCRYPTION_KEY } from './validate-encryption-key-startup';
import { eachKeyedCredentialRow, eachServiceInstanceRow, type EnvelopeStoresClient } from './envelope-stores';

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

/**
 * The client contract for the rotation. Extends the shared envelope-store
 * scans with conditional writes: every update matches the exact stored
 * value alongside the id (compare-and-swap), so a row changed between scan
 * and write is never overwritten with a re-encryption of stale plaintext
 * (which would be unrecoverable), and with single-row re-reads used to
 * classify a compare-and-swap miss.
 */
export type RotateEncryptionKeyClient = EnvelopeStoresClient & {
  credential: {
    updateMany(args: {
      where: { id: string; decryptionKey: string };
      data: { decryptionKey: string };
    }): Promise<{ count: number }>;
    findUnique(args: {
      where: { id: string };
      select: { id: true; decryptionKey: true };
    }): Promise<{ id: string; decryptionKey: string | null } | null>;
  };
  serviceInstance: {
    updateMany(args: { where: { id: string; config: string }; data: { config: string } }): Promise<{ count: number }>;
    findUnique(args: { where: { id: string }; select: { id: true; config: true } }): Promise<{
      id: string;
      config: string;
    } | null>;
  };
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
};

export type RotateEncryptionKeyResult = {
  /**
   * True when blockers (neither-key envelopes, corrupted service configs)
   * stopped the run before any write.
   */
  blocked: boolean;
  serviceInstances: RotationStoreResult & {
    /** Non-envelope configs. Service configs have no plaintext form, so these are corruption; blockers. */
    corruptedIds: string[];
  };
  credentials: RotationStoreResult & {
    /** Brace-prefixed unparseable values; skipped untouched, reported. */
    suspectRowIds: string[];
    /** Legacy plaintext keys; the backfill owns wrapping them, the rotation never touches them. */
    plaintextCount: number;
  };
  /**
   * Both keys' errors from the first neither-key row. The id lists are the
   * record; this is one debugging sample. The errors are deliberately not
   * labelled a key mismatch: AES-GCM throws the identical error for a wrong
   * key and for tampered ciphertext or tag.
   */
  firstNeitherDecrypt?: { rowDescription: string; activeError: unknown; outgoingError: unknown };
};

type Candidate = {
  store: 'serviceInstance' | 'credential';
  id: string;
  stored: string;
  envelope: EncryptedEnvelope;
};

/**
 * Re-encrypts every stored envelope that opens under the outgoing key so it
 * opens under the active key instead.
 *
 * Two phases. A full classification pass first walks both stores, parsing
 * each stored value once and trying the active service before the outgoing
 * one on that same value; any valid envelope neither key opens, or any
 * non-envelope service configuration, blocks the run before a single write
 * (`blocked: true`). Only a blocker-free classification proceeds to the
 * write pass, which re-encrypts each candidate preserving its envelope's
 * algorithm and writes via compare-and-swap; a miss is re-read and
 * classified (deleted, concurrently completed, changed-and-still-rotatable
 * which is retried once against the fresh value, or a conflict left
 * untouched).
 *
 * Idempotent: a re-run finds rows already under the active key and writes
 * nothing; a re-run after a mid-run crash rotates only the remainder.
 *
 * The scan is best-effort under concurrent writes; the documented procedure
 * requires every writer stopped for the rotation window. Compare-and-swap
 * is the backstop for the writer that was missed, not a licence to rotate a
 * live system.
 */
export type RotationPreflightSummary = {
  serviceInstances: { alreadyActive: number; outgoingOpened: number; corrupted: number };
  credentials: { alreadyActive: number; outgoingOpened: number; suspects: number; plaintext: number };
};

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

export async function rotateEncryptionKey(
  client: RotateEncryptionKeyClient,
  services: RotationServices,
  options: RotateEncryptionKeyOptions = {},
): Promise<RotateEncryptionKeyResult> {
  const result: RotateEncryptionKeyResult = {
    blocked: false,
    serviceInstances: emptyStoreResult({ corruptedIds: [] as string[] }),
    credentials: emptyStoreResult({ suspectRowIds: [] as string[], plaintextCount: 0 }),
  };
  const candidates: Candidate[] = [];

  for await (const row of eachServiceInstanceRow(client)) {
    const envelope = parseEnvelope(row.config);
    if (envelope === null) {
      result.serviceInstances.corruptedIds.push(row.id);
      continue;
    }
    classify(result, candidates, services, {
      store: 'serviceInstance',
      id: row.id,
      stored: row.config,
      envelope,
      bucket: result.serviceInstances,
      rowDescription: `service instance ${row.id}`,
    });
  }

  for await (const row of eachKeyedCredentialRow(client)) {
    const envelope = parseEnvelope(row.decryptionKey);
    if (envelope === null) {
      // parseEnvelope already returned null; a brace prefix alone now
      // distinguishes a corrupted-envelope-looking value from legacy
      // plaintext (same rule as looksEnvelopeLikeButInvalid, without
      // parsing the value a second time).
      if (row.decryptionKey.startsWith('{')) {
        result.credentials.suspectRowIds.push(row.id);
      } else {
        result.credentials.plaintextCount += 1;
      }
      continue;
    }
    classify(result, candidates, services, {
      store: 'credential',
      id: row.id,
      stored: row.decryptionKey,
      envelope,
      bucket: result.credentials,
      rowDescription: `credential ${row.id}`,
    });
  }

  if (
    result.serviceInstances.corruptedIds.length > 0 ||
    result.serviceInstances.neitherKeyIds.length > 0 ||
    result.credentials.neitherKeyIds.length > 0
  ) {
    result.blocked = true;
    return result;
  }

  options.onPreflight?.({
    serviceInstances: {
      alreadyActive: result.serviceInstances.alreadyActive,
      outgoingOpened: result.serviceInstances.outgoingOpened,
      corrupted: result.serviceInstances.corruptedIds.length,
    },
    credentials: {
      alreadyActive: result.credentials.alreadyActive,
      outgoingOpened: result.credentials.outgoingOpened,
      suspects: result.credentials.suspectRowIds.length,
      plaintext: result.credentials.plaintextCount,
    },
  });

  for (const candidate of candidates) {
    const bucket = candidate.store === 'serviceInstance' ? result.serviceInstances : result.credentials;
    try {
      await rotateCandidate(client, services, candidate, bucket);
    } catch (error) {
      // Commit-safe wording: the failing write itself may or may not have
      // committed, so state only what was confirmed, never the exact key
      // mixture of the store.
      const rotatedSoFar = result.serviceInstances.rotated + result.credentials.rotated;
      const stateNote =
        rotatedSoFar > 0
          ? `${rotatedSoFar} write(s) confirmed before the failure`
          : 'no write had been confirmed before the failure';
      throw new Error(
        `Failed to rotate ${describe(candidate)} (${stateNote}). The rotation may be incomplete: keep writers ` +
          'stopped and re-run with the same key pair; the run converges.',
        { cause: error },
      );
    }
  }

  return result;
}

function emptyStoreResult<Extra extends object>(extra: Extra): RotationStoreResult & Extra {
  return {
    alreadyActive: 0,
    outgoingOpened: 0,
    rotated: 0,
    neitherKeyIds: [],
    deletedIds: [],
    concurrentlyCompletedIds: [],
    conflictIds: [],
    ...extra,
  };
}

function classify(
  result: RotateEncryptionKeyResult,
  candidates: Candidate[],
  services: RotationServices,
  row: Candidate & { bucket: RotationStoreResult; rowDescription: string },
): void {
  const activeFailure = decryptFailure(services.activeService, row.envelope);
  if (activeFailure === null) {
    row.bucket.alreadyActive += 1;
    return;
  }
  const outgoingFailure = decryptFailure(services.outgoingService, row.envelope);
  if (outgoingFailure === null) {
    row.bucket.outgoingOpened += 1;
    candidates.push({ store: row.store, id: row.id, stored: row.stored, envelope: row.envelope });
    return;
  }
  row.bucket.neitherKeyIds.push(row.id);
  result.firstNeitherDecrypt ??= {
    rowDescription: row.rowDescription,
    activeError: activeFailure.error,
    outgoingError: outgoingFailure.error,
  };
}

async function rotateCandidate(
  client: RotateEncryptionKeyClient,
  services: RotationServices,
  candidate: Candidate,
  bucket: RotationStoreResult,
): Promise<void> {
  const written = await casWrite(client, services, candidate);
  if (written) {
    bucket.rotated += 1;
    return;
  }

  // The compare-and-swap missed: the row is gone or its value changed after
  // classification. Re-read and decide from the current value; never write
  // over a value this run has not examined.
  const current = await readCurrent(client, candidate);
  if (current.missing) {
    bucket.deletedIds.push(candidate.id);
    return;
  }
  if (current.value === null) {
    // The row still exists but its key was cleared: a changed value this
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
    const retried = await casWrite(client, services, { ...candidate, stored: current.value, envelope });
    if (retried) {
      bucket.rotated += 1;
      return;
    }
  }
  bucket.conflictIds.push(candidate.id);
}

/** True when the conditional write landed on exactly the expected value. */
async function casWrite(
  client: RotateEncryptionKeyClient,
  services: RotationServices,
  candidate: Candidate,
): Promise<boolean> {
  const plaintext = services.outgoingService.decrypt(candidate.envelope);
  // Preserve the envelope's algorithm: rotation is a key-only operation,
  // never an implicit algorithm migration.
  const rotated = JSON.stringify(services.activeService.encrypt(plaintext, candidate.envelope.type));
  const { count } =
    candidate.store === 'serviceInstance'
      ? await client.serviceInstance.updateMany({
          where: { id: candidate.id, config: candidate.stored },
          data: { config: rotated },
        })
      : await client.credential.updateMany({
          where: { id: candidate.id, decryptionKey: candidate.stored },
          data: { decryptionKey: rotated },
        });
  return count === 1;
}

/**
 * Missing (row gone) and present-with-null-value are distinct outcomes: a
 * credential whose key was cleared still exists, and reporting it deleted
 * would misdescribe the store.
 */
async function readCurrent(
  client: RotateEncryptionKeyClient,
  candidate: Candidate,
): Promise<{ missing: true } | { missing: false; value: string | null }> {
  if (candidate.store === 'serviceInstance') {
    const row = await client.serviceInstance.findUnique({
      where: { id: candidate.id },
      select: { id: true, config: true },
    });
    return row === null ? { missing: true } : { missing: false, value: row.config };
  }
  const row = await client.credential.findUnique({
    where: { id: candidate.id },
    select: { id: true, decryptionKey: true },
  });
  return row === null ? { missing: true } : { missing: false, value: row.decryptionKey };
}

function describe(candidate: Candidate): string {
  return `${candidate.store === 'serviceInstance' ? 'service instance' : 'credential'} ${candidate.id}`;
}

/** Null on success; the thrown error on failure. */
function decryptFailure(
  service: Pick<IEncryptionService, 'decrypt'>,
  envelope: EncryptedEnvelope,
): { error: unknown } | null {
  try {
    service.decrypt(envelope);
    return null;
  } catch (error) {
    return { error };
  }
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

/** One line of the operator-facing rotation report, tagged with its stream. */
export type RotationReportLine = { text: string; stream: 'out' | 'err' };

export type RotationReport = { lines: RotationReportLine[]; exitCode: 0 | 1 };

/**
 * Renders the rotation result as the operator-facing report and exit code,
 * separate from the CLI's process wiring so the output contract is
 * testable. Exit 0 only when every valid envelope ended under the active
 * key with nothing skipped as suspect or lost to a conflict or delete;
 * plaintext leftovers alone stay exit 0 (wrapping them is the backfill's
 * job). Operational failures never reach this function.
 */
export function buildRotationReport(result: RotateEncryptionKeyResult, docsUrl: string): RotationReport {
  const lines: RotationReportLine[] = [];
  const out = (text: string) => lines.push({ text, stream: 'out' });
  const err = (text: string) => lines.push({ text, stream: 'err' });
  const ids = (label: string, rowIds: string[]) => {
    if (rowIds.length > 0) {
      err(`  ${label} (${rowIds.length}): ${rowIds.join(', ')}`);
    }
  };

  for (const [heading, store] of [
    ['Service instance configurations:', result.serviceInstances],
    ['Credential decryption keys:', result.credentials],
  ] as const) {
    out(heading);
    out(`  already under the active key: ${store.alreadyActive}`);
    out(`  opened only under the outgoing key: ${store.outgoingOpened}`);
    out(`  rotated from the outgoing key: ${store.rotated}`);
    ids('decrypted under neither supplied key', store.neitherKeyIds);
    if ('corruptedIds' in store) {
      ids('not a valid encrypted envelope', store.corruptedIds);
    }
    if ('suspectRowIds' in store) {
      ids('corrupted envelope-like, left untouched', store.suspectRowIds);
      if (store.plaintextCount > 0) {
        out(
          `  legacy plaintext keys, left untouched: ${store.plaintextCount} ` +
            '(wrap them with backfill:decryption-keys under the new key)',
        );
      }
    }
    ids('deleted between scan and write', store.deletedIds);
    ids('already rotated by a concurrent run', store.concurrentlyCompletedIds);
    ids('changed during the run, left untouched', store.conflictIds);
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
  const totals = [result.serviceInstances, result.credentials];
  const anyEnvelope = totals.some((store) => store.alreadyActive + store.outgoingOpened > 0);
  const outgoingOpenedTotal = totals.reduce((sum, store) => sum + store.outgoingOpened, 0);

  const incomplete =
    result.credentials.suspectRowIds.length > 0 ||
    totals.some((store) => store.deletedIds.length + store.conflictIds.length > 0);

  if (!anyEnvelope) {
    out(
      'Note: no stored envelope opened under either supplied key (empty or plaintext-only stores); ' +
        'there was nothing to rotate and neither key was proven.',
    );
    if (incomplete) {
      err(`Run finished incomplete; inspect the rows above. See ${docsUrl}`);
      return { lines, exitCode: 1 };
    }
    out('Nothing was modified.');
    return { lines, exitCode: 0 };
  }

  if (outgoingOpenedTotal === 0) {
    out(
      'The outgoing key opened nothing; every envelope already opens under the active key. ' +
        'Nothing was rotated. If a rotation was expected, check the two variables are not reversed.',
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

function errorMessage(error: unknown): string {
  // Duck-typed rather than `instanceof Error`: the services package can
  // throw from another realm (it does under jest).
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : String(error);
}
