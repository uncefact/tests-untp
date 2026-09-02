/**
 * Every column encrypted at rest under DATA_ENCRYPTION_KEY, as one list, and
 * the operations a key-lifecycle step needs over each: the port. The audit
 * (audit-encryption.ts), the rotation (rotate-encryption-key.ts), the
 * startup validation (validate-encryption-key-startup.ts) and the backfill
 * preflight (backfill-decryption-keys.ts) walk the list from here and call
 * only these operations, so a column added here is covered by every
 * operation at once, and none of them knows how a store is read or written.
 *
 * The data access is an adapter. prisma-envelope-stores.ts implements the
 * operations for every store over the Prisma client, and the build holds it
 * and the schema's `@encryptedAtRest` tags in step (ADR-055). The backfill's
 * wrap pass writes one column directly rather than through the port; it is
 * the one lifecycle step that changes what a store holds.
 */
// Relative import (not the @/ alias): this module runs inside the Docker
// image via tsx, where no tsconfig.json exists to resolve path aliases.
import { looksEnvelopeLikeButInvalid } from './decryption-key-protection';

/** The stores, in the order every operation walks them (see ENVELOPE_STORE_INFO). */
export const ENVELOPE_STORE_IDS = [
  'serviceInstances',
  'credentials',
  'externalCredentials',
  'idempotencyResponses',
] as const;

export type EnvelopeStoreId = (typeof ENVELOPE_STORE_IDS)[number];

/** What an operation needs to know about a store beyond how to read it. */
export type EnvelopeStoreInfo = {
  /** The heading an operator report prints for this store. */
  readonly heading: string;
  /** How one row is named in messages ("credential cred-1"). */
  readonly rowName: string;
  /** What the value is, for messages ("decryption key"). */
  readonly valueName: string;
  /** The log field a row's id is written under, kept stable so alerts keyed on it keep matching. */
  readonly logIdField: string;
  /**
   * Whether a value that is not an envelope may legitimately exist. True only
   * for native credential keys written before encryption at rest (#697),
   * which the backfill wraps. Everywhere else a non-envelope value is
   * corruption.
   */
  readonly plaintextAllowed: boolean;
  /**
   * Whether the application can lose this value. A damaged or unopenable row
   * in a discardable store never stops a rotation, blocks the backfill or
   * fails startup, and never counts as proof that the key is right: the
   * value is a cache the request path already treats as expendable. A
   * rotation clears such a row (the value goes, the row stays) rather than
   * leave material under a key that may be compromised, and the audit
   * reports it with `remedy`. Everywhere else such a row is a blocker,
   * because losing the value is unrecoverable.
   */
  readonly discardable: boolean;
  /** What an operator does about a damaged or unopenable row; only a discardable store has one. */
  readonly remedy?: string;
};

/**
 * Service instance configurations come first because every writer encrypts
 * one before persistence, so any row is a valid startup sample; the keyed
 * stores follow, and are only reached once the one before is exhausted.
 */
export const ENVELOPE_STORE_INFO: Record<EnvelopeStoreId, EnvelopeStoreInfo> = {
  serviceInstances: {
    heading: 'Service instance configurations:',
    rowName: 'service instance',
    valueName: 'configuration',
    logIdField: 'instanceId',
    plaintextAllowed: false,
    discardable: false,
  },
  credentials: {
    heading: 'Credential decryption keys:',
    rowName: 'credential',
    valueName: 'decryption key',
    logIdField: 'credentialId',
    plaintextAllowed: true,
    discardable: false,
  },
  // The receiver-side key our own storage service returned for the durable
  // copy of a credential registered from a third party; a supplier's key is
  // never stored (ADR-055 decision 2). This column has never held legacy
  // plaintext, so a non-envelope value is corruption, and losing the value
  // loses the only key that opens our copy.
  externalCredentials: {
    heading: 'External credential decryption keys:',
    rowName: 'external credential',
    valueName: 'decryption key',
    logIdField: 'externalCredentialId',
    plaintextAllowed: false,
    discardable: false,
  },
  // A replay body is the recorded response a retry is answered with. While
  // an unreadable one remains, the request path answers a retry with the
  // recorded credential and a warning; once cleared, with the credential
  // alone (ADR-051). So the lifecycle clears it rather than stopping. The
  // claim itself is never deleted: it is what stops a retry minting a second
  // credential.
  idempotencyResponses: {
    heading: 'Idempotency replay bodies:',
    rowName: 'idempotency claim',
    valueName: 'replay body',
    logIdField: 'claimId',
    plaintextAllowed: false,
    discardable: true,
    remedy:
      'clear the replay body of the affected claims and keep the claims themselves (a retry is then answered with the recorded credential alone)',
  },
};

/** How a stored value that is not a valid envelope is read. */
export type NonEnvelope =
  /** In a store that never holds plaintext: damaged data, whatever it looks like. */
  | 'corrupted'
  /** Envelope-shaped but unparseable, in a store that allows plaintext: neither decryptable nor plausible legacy plaintext. */
  | 'suspect'
  /** Legacy plaintext the backfill can wrap. */
  | 'plaintext';

/**
 * Classifies a stored value that parseEnvelope rejected, by the store's rule.
 * The one place the rule lives, so the audit and the rotation cannot drift
 * apart on it.
 */
export function classifyNonEnvelope(id: EnvelopeStoreId, value: string): NonEnvelope {
  if (!ENVELOPE_STORE_INFO[id].plaintextAllowed) {
    return 'corrupted';
  }
  return looksEnvelopeLikeButInvalid(value) ? 'suspect' : 'plaintext';
}

/** The buckets a non-envelope value lands in; the audit's and the rotation's per-store results both carry them. */
export type NonEnvelopeCounts = { corruptedIds: string[]; suspectRowIds: string[]; plaintextCount: number };

/** Records a non-envelope value in the bucket its classification belongs to. */
export function recordNonEnvelope(bucket: NonEnvelopeCounts, kind: NonEnvelope, id: string): void {
  if (kind === 'corrupted') {
    bucket.corruptedIds.push(id);
  } else if (kind === 'suspect') {
    bucket.suspectRowIds.push(id);
  } else {
    bucket.plaintextCount += 1;
  }
}

/**
 * The stores whose findings stop a run, given each caller's own test for
 * "this store has findings"; a discardable store's findings never do.
 */
export function blockingStores(hasFindings: (id: EnvelopeStoreId) => boolean): EnvelopeStoreId[] {
  return ENVELOPE_STORE_IDS.filter((id) => !ENVELOPE_STORE_INFO[id].discardable && hasFindings(id));
}

/** One stored value with its row id: an envelope, or legacy plaintext where a store allows it. */
export type StoredValue = { id: string; value: string };

/** A row's current value: gone, present with its value cleared, or present with a value. */
export type CurrentValue = { kind: 'missing' } | { kind: 'cleared' } | { kind: 'present'; value: string };

/** The operations every key-lifecycle step needs over one store. */
export interface EnvelopeStore {
  /**
   * Every row holding a value, in id order via cursor pagination
   * (`id > cursor`), which does not skip surviving rows when others are
   * deleted mid-run.
   */
  rows(): AsyncGenerator<StoredValue>;
  /**
   * The rows the startup validator samples. Every row holding a value, except
   * that a store which allows legacy plaintext must narrow to envelope-shaped
   * values (starting with "{"), or startup would log and skip plaintext rows
   * on every boot.
   */
  candidates(): AsyncGenerator<StoredValue>;
  /** Writes `next` only while the stored value is still `expected`; true when the write landed. */
  casWrite(id: string, expected: string, next: string): Promise<boolean>;
  /**
   * Clears the value (the row stays) only while it is still `expected`; true
   * when the write landed. Only a discardable store is ever asked to.
   */
  discard(id: string, expected: string): Promise<boolean>;
  /** The current value of one row. */
  readCurrent(id: string): Promise<CurrentValue>;
}

export type EnvelopeStores = Record<EnvelopeStoreId, EnvelopeStore>;

/** One value per store, built fresh for each, for results keyed by store. */
export function perStore<T>(make: (id: EnvelopeStoreId, info: EnvelopeStoreInfo) => T): Record<EnvelopeStoreId, T> {
  return Object.fromEntries(ENVELOPE_STORE_IDS.map((id) => [id, make(id, ENVELOPE_STORE_INFO[id])])) as Record<
    EnvelopeStoreId,
    T
  >;
}

/**
 * The cursor walk an adapter builds `rows` and `candidates` from. `fetch`
 * returns the page after the cursor with each row already mapped to its id
 * and value, in id order. The cursor advances from the last fetched row, not
 * the last yielded one, so a page ending on a null value still moves on;
 * rows whose value is null are skipped.
 */
export async function* eachPage(
  fetch: (cursor: string | undefined) => Promise<Array<{ id: string; value: string | null }>>,
): AsyncGenerator<StoredValue> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await fetch(cursor);
    if (rows.length === 0) {
      return;
    }
    cursor = rows[rows.length - 1].id;
    for (const row of rows) {
      if (row.value !== null) {
        yield { id: row.id, value: row.value };
      }
    }
  }
}
