import {
  decryptCredentialToBytes,
  hasValidEnvelopeStructure,
  isEncryptedEnvelope,
  type EnvelopedVerifiableCredential,
} from '@uncefact/untp-ri-services';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import { CredentialStatusCapture, CredentialStatusProvenance, LibraryRecordOrigin, Prisma } from '../prisma/generated';
import { createCredentialStatusEntries } from '../prisma/repositories/credential-status-entry.repository';
import { updateCredentialStatusCapture as updateCapture } from '../prisma/repositories/credential.repository';
import { revealDecryptionKey } from './decryption-key-protection';
import { credentialDigestPreimage, fetchStoredCopyBytes } from '../library/verify-generation-job';
import { captureCredentialStatusEntries } from './capture-credential-status-entries';
import type { CapturedCredentialStatusEntry } from './capture-credential-status-entries';
import { appLogger } from '@/lib/api/logger';

const BATCH_SIZE = 100;
export const RETRYABLE_CREDENTIAL_STATUS_BACKFILL_FAILURES = ['STORAGE_UNAVAILABLE', 'DECRYPT_FAILED'] as const;
const logger = appLogger.child({ module: 'backfill-credential-status-entries' });

export type CredentialStatusBackfillFailureClass =
  | 'UNREADABLE_ENVELOPE'
  | 'DECRYPT_FAILED'
  | 'MALFORMED_ENTRY'
  | 'AMBIGUOUS_PURPOSE'
  | 'PURPOSE_MISSING'
  | 'STORAGE_UNAVAILABLE'
  | 'WRITE_RACE';

export type CredentialStatusBackfillFailure = {
  id: string;
  errorClass: CredentialStatusBackfillFailureClass;
  message: string;
};

export type CredentialStatusBackfillCapture = {
  id: string;
  entries: Array<
    Pick<CapturedCredentialStatusEntry['canonical'], 'statusPurpose' | 'statusListCredential' | 'statusListIndex'>
  >;
};

export type CredentialStatusBackfillResult = {
  dryRun: boolean;
  retryFailed: boolean;
  scanned: number;
  captured: number;
  failed: number;
  /** Number of FAILED rows still present in the complete backfill scope. */
  failedRows: number;
  /** Persisted FAILED rows grouped by their stored failure class. */
  failedByClass: Record<string, number>;
  /** Persisted FAILED rows remaining in scope, including their ids and classes. */
  remainingFailures: Array<Pick<CredentialStatusBackfillFailure, 'id' | 'errorClass'>>;
  failures: CredentialStatusBackfillFailure[];
  capturedRows: CredentialStatusBackfillCapture[];
};

export type CredentialStatusBackfillOptions = {
  dryRun?: boolean;
  retryFailed?: boolean;
  tenantId?: string;
  fetchStoredCopy?: typeof fetchStoredCopyBytes;
};

type BackfillRow = {
  id: string;
  tenantId: string;
  credential: {
    storageUri: string;
    digestMultibase: string;
    decryptionKey: string | null;
    statusCapture: CredentialStatusCapture;
    statusCaptureError: string | null;
  } | null;
};

export class CredentialStatusBackfillRowError extends Error {
  constructor(
    readonly errorClass: Exclude<CredentialStatusBackfillFailureClass, 'WRITE_RACE'>,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CredentialStatusBackfillRowError';
  }
}

/** Classifies a row failure so reports never collapse storage and data errors. */
export function classifyCredentialStatusBackfillFailure(error: unknown): CredentialStatusBackfillFailureClass {
  if (error instanceof CredentialStatusBackfillRowError) return error.errorClass;
  return 'STORAGE_UNAVAILABLE';
}

export function isRetryableCredentialStatusBackfillFailure(errorClass: string): boolean {
  return (RETRYABLE_CREDENTIAL_STATUS_BACKFILL_FAILURES as readonly string[]).includes(errorClass);
}

/** Returns the operator action gate for a completed backfill run. */
export function credentialStatusBackfillExitCode(result: CredentialStatusBackfillResult): 0 | 1 {
  return result.failed > 0 ||
    result.remainingFailures.some(({ errorClass }) => isRetryableCredentialStatusBackfillFailure(errorClass))
    ? 1
    : 0;
}

/** Formats the coordinates captured for one row for both operator modes. */
export function formatCredentialStatusCapture(row: CredentialStatusBackfillCapture, dryRun: boolean): string {
  const purposes = row.entries.map((entry) => entry.statusPurpose).join(', ');
  const coordinates = row.entries
    .map((entry) => `statusListCredential=${entry.statusListCredential} statusListIndex=${entry.statusListIndex}`)
    .join('; ');
  return `${dryRun ? 'Dry run would capture' : 'Captured'} ${row.id}: purposes=${purposes}; ${coordinates}`;
}

async function readEntries(
  row: BackfillRow,
  fetchCopy: typeof fetchStoredCopyBytes,
): Promise<Parameters<typeof createCredentialStatusEntries>[1]['entries']> {
  if (row.credential === null) {
    throw new CredentialStatusBackfillRowError('STORAGE_UNAVAILABLE', 'The native credential child is missing');
  }

  let bytes: Uint8Array;
  try {
    bytes = await fetchCopy(row.credential.storageUri, 10_000);
  } catch (error) {
    throw new CredentialStatusBackfillRowError('STORAGE_UNAVAILABLE', 'The stored copy could not be read', {
      cause: error,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (error) {
    throw new CredentialStatusBackfillRowError('UNREADABLE_ENVELOPE', 'The stored copy is not valid JSON', {
      cause: error,
    });
  }

  if (isEncryptedEnvelope(parsed)) {
    if (row.credential.decryptionKey === null || !hasValidEnvelopeStructure(parsed)) {
      throw new CredentialStatusBackfillRowError('DECRYPT_FAILED', 'The stored copy is encrypted but cannot be opened');
    }
    let key: string | null;
    try {
      key = revealDecryptionKey(row.credential.decryptionKey);
      if (key === null) throw new Error('stored decryption key is empty');
      const plaintextBytes = decryptCredentialToBytes({ ...parsed, key });
      parsed = JSON.parse(Buffer.from(plaintextBytes).toString('utf8'));
    } catch (error) {
      throw new CredentialStatusBackfillRowError('DECRYPT_FAILED', 'The stored copy could not be decrypted', {
        cause: error,
      });
    }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CredentialStatusBackfillRowError('UNREADABLE_ENVELOPE', 'The stored copy is not a credential object');
  }

  try {
    if (!(await MultibaseDigest.fromString(row.credential.digestMultibase).verify(credentialDigestPreimage(parsed)))) {
      throw new CredentialStatusBackfillRowError('STORAGE_UNAVAILABLE', 'The stored copy digest does not match');
    }
  } catch (error) {
    if (error instanceof CredentialStatusBackfillRowError) throw error;
    throw new CredentialStatusBackfillRowError('STORAGE_UNAVAILABLE', 'The stored copy digest could not be checked', {
      cause: error,
    });
  }

  const captured = captureCredentialStatusEntries(parsed as EnvelopedVerifiableCredential, []);
  if ('failure' in captured) {
    throw new CredentialStatusBackfillRowError(captured.failure, `Status capture failed: ${captured.failure}`);
  }
  return captured.entries.map(({ canonical, wire, statusListVcIssuer }) => ({
    canonical,
    wire,
    statusListVcIssuer,
    provenance: CredentialStatusProvenance.BACKFILL,
  }));
}

/**
 * Captures status metadata for pre-change native records. Storage work happens
 * before the short write transaction; the entry insert and conditional state
 * transition happen together, so a concurrent operator run cannot overwrite a
 * row that has moved on.
 */
export async function backfillCredentialStatusEntries(
  client: PrismaClientLike,
  options: CredentialStatusBackfillOptions = {},
): Promise<CredentialStatusBackfillResult> {
  const dryRun = options.dryRun === true;
  const retryFailed = options.retryFailed === true;
  const tenantId = options.tenantId;
  const fetchCopy = options.fetchStoredCopy ?? fetchStoredCopyBytes;
  const result: CredentialStatusBackfillResult = {
    dryRun,
    retryFailed,
    scanned: 0,
    captured: 0,
    failed: 0,
    failedRows: 0,
    failedByClass: {},
    remainingFailures: [],
    failures: [],
    capturedRows: [],
  };

  for await (const row of eachRow(client, retryFailed, tenantId)) {
    result.scanned += 1;
    let entries: Parameters<typeof createCredentialStatusEntries>[1]['entries'];
    try {
      entries = await readEntries(row, fetchCopy);
    } catch (error) {
      const errorClass = classifyCredentialStatusBackfillFailure(error);
      const failure: CredentialStatusBackfillFailure = {
        id: row.id,
        errorClass,
        message: actionableFailureMessage(errorClass, error instanceof Error ? error.message : String(error)),
      };
      result.failed += 1;
      result.failures.push(failure);
      if (!dryRun) await markFailed(client, row, failure);
      continue;
    }

    if (dryRun) {
      result.captured += 1;
      result.capturedRows.push({
        id: row.id,
        entries: entries.map(({ canonical }) => ({
          statusPurpose: canonical.statusPurpose,
          statusListCredential: canonical.statusListCredential,
          statusListIndex: canonical.statusListIndex,
        })),
      });
      continue;
    }

    try {
      await client.$transaction(async (tx) => {
        const created = await createCredentialStatusEntries(tx, {
          credentialId: row.id,
          tenantId: row.tenantId,
          entries,
        });
        if (created.outcome !== 'created') {
          throw new CredentialStatusBackfillRowError(
            'AMBIGUOUS_PURPOSE',
            `Duplicate status purpose ${created.purpose} already exists`,
          );
        }
        const updated = await updateCapture(tx, {
          credentialId: row.id,
          tenantId: row.tenantId,
          expectedStatus: row.credential?.statusCapture ?? CredentialStatusCapture.PENDING,
          statusCapture: CredentialStatusCapture.CAPTURED,
          statusCapturedAt: new Date(),
        });
        if (updated !== 'updated') throw new WriteRaceError();
      });
      result.captured += 1;
      result.capturedRows.push({
        id: row.id,
        entries: entries.map(({ canonical }) => ({
          statusPurpose: canonical.statusPurpose,
          statusListCredential: canonical.statusListCredential,
          statusListIndex: canonical.statusListIndex,
        })),
      });
    } catch (error) {
      const errorClass =
        error instanceof WriteRaceError ? 'WRITE_RACE' : classifyCredentialStatusBackfillFailure(error);
      if (errorClass === 'STORAGE_UNAVAILABLE') {
        logger.warn(
          { err: error, credentialId: row.id, tenantId: row.tenantId },
          'Status-entry capture could not be persisted; re-run the backfill with --retry-failed',
        );
      }
      const failure = {
        id: row.id,
        errorClass,
        message: actionableFailureMessage(errorClass, error instanceof Error ? error.message : String(error)),
      } satisfies CredentialStatusBackfillFailure;
      result.failed += 1;
      result.failures.push(failure);
      if (errorClass !== 'WRITE_RACE') await markFailed(client, row, failure);
    }
  }
  const failedState = await countFailedRows(client, tenantId);
  result.failedRows = failedState.count;
  result.failedByClass = failedState.byClass;
  result.remainingFailures = failedState.rows;
  return result;
}

class WriteRaceError extends Error {
  constructor() {
    super('The credential status row changed before capture was committed; re-run the backfill');
    this.name = 'WriteRaceError';
  }
}

function actionableFailureMessage(errorClass: CredentialStatusBackfillFailureClass, detail: string): string {
  const remediation = isRetryableCredentialStatusBackfillFailure(errorClass)
    ? 'Run backfill-credential-status-entries --retry-failed after the dependency is available.'
    : errorClass === 'WRITE_RACE'
      ? 'Re-run backfill-credential-status-entries to process the row from its current state.'
      : `Investigate the provider output for ${errorClass}; this class is not retryable by the backfill.`;
  return `${detail.replace(/[.]?$/, '')}. ${remediation}`;
}

async function countFailedRows(
  client: PrismaClientLike,
  tenantId: string | undefined,
): Promise<{
  count: number;
  byClass: Record<string, number>;
  rows: Array<Pick<CredentialStatusBackfillFailure, 'id' | 'errorClass'>>;
}> {
  const rows = (await client.credential.findMany({
    where: {
      origin: LibraryRecordOrigin.NATIVE,
      statusCapture: CredentialStatusCapture.FAILED,
      ...(tenantId === undefined ? {} : { tenantId }),
    },
    select: { id: true, statusCaptureError: true },
  })) as Array<{ id: string; statusCaptureError: string | null }>;
  const byClass: Record<string, number> = {};
  const failedRows: Array<Pick<CredentialStatusBackfillFailure, 'id' | 'errorClass'>> = [];
  for (const row of rows) {
    const errorClass = (row.statusCaptureError ?? 'UNKNOWN') as CredentialStatusBackfillFailureClass;
    byClass[errorClass] = (byClass[errorClass] ?? 0) + 1;
    failedRows.push({ id: row.id, errorClass });
  }
  return { count: rows.length, byClass, rows: failedRows };
}

async function markFailed(
  client: PrismaClientLike,
  row: BackfillRow,
  failure: CredentialStatusBackfillFailure,
): Promise<void> {
  try {
    const result = await client.$transaction(async (tx) =>
      updateCapture(tx, {
        credentialId: row.id,
        tenantId: row.tenantId,
        expectedStatus: row.credential?.statusCapture ?? CredentialStatusCapture.PENDING,
        statusCapture: CredentialStatusCapture.FAILED,
        statusCaptureError: failure.errorClass,
        statusCapturedAt: new Date(),
      }),
    );
    if (result !== 'updated') {
      failure.errorClass = 'WRITE_RACE';
      failure.message = 'The credential status row changed before its failure could be recorded';
    }
  } catch (error) {
    failure.errorClass = 'STORAGE_UNAVAILABLE';
    failure.message = actionableFailureMessage(
      failure.errorClass,
      'The credential status failure could not be recorded',
    );
    logger.warn(
      { err: error, credentialId: row.id, tenantId: row.tenantId },
      'Status-entry capture failure could not be recorded; run the backfill again when storage is available',
    );
  }
}

async function* eachRow(
  client: PrismaClientLike,
  retryFailed: boolean,
  tenantId: string | undefined,
): AsyncGenerator<BackfillRow> {
  let cursor: string | undefined;
  for (;;) {
    const rows = (await client.libraryRecord.findMany({
      where: {
        origin: LibraryRecordOrigin.NATIVE,
        ...(tenantId === undefined ? {} : { tenantId }),
        credential: retryFailed
          ? {
              OR: [
                { statusCapture: CredentialStatusCapture.PENDING },
                {
                  statusCapture: CredentialStatusCapture.FAILED,
                  statusCaptureError: { in: [...RETRYABLE_CREDENTIAL_STATUS_BACKFILL_FAILURES] },
                },
              ],
            }
          : { statusCapture: CredentialStatusCapture.PENDING },
        ...(cursor === undefined ? {} : { id: { gt: cursor } }),
      },
      select: {
        id: true,
        tenantId: true,
        credential: {
          select: {
            storageUri: true,
            digestMultibase: true,
            decryptionKey: true,
            statusCapture: true,
            statusCaptureError: true,
          },
        },
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    } as Prisma.LibraryRecordFindManyArgs)) as BackfillRow[];
    if (rows.length === 0) return;
    cursor = rows[rows.length - 1].id;
    yield* rows;
  }
}

export type PrismaClientLike = {
  libraryRecord: { findMany(args: Prisma.LibraryRecordFindManyArgs): Promise<unknown[]> };
  credential: { findMany(args: Prisma.CredentialFindManyArgs): Promise<unknown[]> };
  $transaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
};
