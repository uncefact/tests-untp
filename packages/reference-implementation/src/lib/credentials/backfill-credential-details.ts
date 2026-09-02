// Subpath imports rather than the package barrel: the barrel reaches modules
// whose deep dependencies do not resolve under the CJS loader this script is
// run with, so the operator CLI would fail at import time.
import { getBridge, listRegisteredVersions } from '@uncefact/untp-ri-services/data-model-bridges';
import {
  decodeCredential,
  type EnvelopedVerifiableCredential,
  type UNTPVerifiableCredential,
} from '@uncefact/untp-ri-services/verifiable-credential';
import {
  decryptCredential,
  hasValidEnvelopeStructure,
  isEncryptedEnvelope,
} from '@uncefact/untp-ri-services/encryption';
import {
  CredentialDetailsError,
  CredentialDetailsStatus,
  LibraryRecordOrigin,
  type CoreCredentialType,
} from '../prisma/generated';
import { extractCredentialDetails } from './extract-credential-details';
import { bridgeNameOf, coreCredentialTypeFromTypes, coreCredentialTypeOf } from '../library/core-credential-type';
import { revealDecryptionKey } from './decryption-key-protection';

const BATCH_SIZE = 100;

export type BackfillFailure = {
  id: string;
  /**
   * The error class marked on a row whose extraction failed, or
   * `WRITE_FAILED`, a report-only class for a row this pass could not write
   * (a write error, or a row another process changed after it was read),
   * which says nothing about the credential.
   */
  errorClass: CredentialDetailsError | 'WRITE_FAILED';
  message: string;
};

export type BackfillCredentialDetailsResult = {
  dryRun: boolean;
  scanned: number;
  /** Rows whose descriptive fields were extracted and written. */
  updated: number;
  /** Rows already extracted that only had their core kind filled in. */
  coreKindsResolved: number;
  failed: number;
  failures: BackfillFailure[];
};

export type BackfillCredentialDetailsOptions = {
  dryRun?: boolean;
  /**
   * Returns the storage response body as text. Defaults to `fetch`. Tests
   * inject a stub so the suite does not reach the network.
   */
  fetchArtifact?: (uri: string) => Promise<string>;
};

/**
 * A native library record still awaiting capture, with the storage columns
 * of its `Credential` child (ADR-053 decisions 1 and 5). `credential` is
 * null only for a parent whose child is missing, which the write paths never
 * produce; the row is then reported, not skipped.
 */
type PendingRecordRow = {
  id: string;
  detailsStatus: CredentialDetailsStatus;
  credentialType: string | null;
  coreCredentialType: CoreCredentialType | null;
  coreDataModelVersion: string | null;
  credential: { storageUri: string; decryptionKey: string | null } | null;
};

/**
 * The subset of the Prisma client the backfill needs. Structural so tests can
 * supply an in-memory fake.
 */
export type BackfillClient = {
  libraryRecord: {
    findMany(args: {
      where: {
        origin: typeof LibraryRecordOrigin.NATIVE;
        OR: [{ detailsStatus: typeof CredentialDetailsStatus.EXTRACTION_PENDING }, { coreCredentialType: null }];
        id?: { gt: string };
      };
      select: {
        id: true;
        detailsStatus: true;
        credentialType: true;
        coreCredentialType: true;
        coreDataModelVersion: true;
        credential: { select: { storageUri: true; decryptionKey: true } };
      };
      orderBy: { id: 'asc' };
      take: number;
    }): Promise<PendingRecordRow[]>;
    updateMany(args: {
      where:
        | { id: string; detailsStatus: typeof CredentialDetailsStatus.EXTRACTION_PENDING }
        | { id: string; coreCredentialType: null };
      data: {
        name?: string | null;
        issuerName?: string | null;
        issuerDid?: string | null;
        subjectName?: string | null;
        subjectId?: string | null;
        validFrom?: Date | null;
        validUntil?: Date | null;
        detailsStatus?: CredentialDetailsStatus;
        detailsError?: CredentialDetailsError | null;
        coreDataModelVersion?: string | null;
        coreCredentialType?: CoreCredentialType | null;
      };
    }): Promise<{ count: number }>;
  };
};

function writeFailure(id: string, error: unknown): BackfillFailure {
  const message = error instanceof Error ? error.message : String(error);
  return {
    id,
    errorClass: 'WRITE_FAILED',
    message: `Failed to write the row's outcome: ${message}`,
  };
}

class RowError extends Error {
  readonly errorClass: CredentialDetailsError;

  constructor(errorClass: CredentialDetailsError, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RowError';
    this.errorClass = errorClass;
  }
}

/**
 * Reads existing credential rows whose descriptive fields were never captured
 * (`EXTRACTION_PENDING`) and writes the library-facing details, using the same
 * decrypt / decode sequence as the verify route. The fetch itself is plainer
 * than the verify route's guarded resolver on purpose: these URIs were
 * written by the storage adapter at issue time, not supplied by a caller,
 * and a deployment's own storage service legitimately lives on private
 * addresses, which that guard exists to refuse.
 *
 * Operator-run (#953, ADR-043): the job fetches every tenant's stored
 * artefact, so it is not part of startup. Re-running converges for every
 * record it can resolve, and keeps reporting the ones it cannot. A row is
 * selected while its descriptive fields are still `EXTRACTION_PENDING`, and
 * also, whatever its status, while its core kind is unknown, because the
 * migration that introduced the parent row could not read the artefact and
 * left some records with no core kind (ADR-053 decision 8). For such a row
 * only the core kind is written; its descriptive fields and status stand. A
 * dry run performs the same per-row work without writing.
 */
export async function backfillCredentialDetails(
  client: BackfillClient,
  options: BackfillCredentialDetailsOptions = {},
): Promise<BackfillCredentialDetailsResult> {
  const dryRun = options.dryRun === true;
  const fetchArtifact = options.fetchArtifact ?? defaultFetchArtifact;
  const result: BackfillCredentialDetailsResult = {
    dryRun,
    scanned: 0,
    updated: 0,
    coreKindsResolved: 0,
    failed: 0,
    failures: [],
  };

  for await (const row of eachPendingCredentialRow(client)) {
    result.scanned += 1;
    // Selected for an unknown core kind rather than pending fields: only the
    // kind is written, and a failure is reported, never marked on the row.
    const kindOnly = row.detailsStatus !== CredentialDetailsStatus.EXTRACTION_PENDING;
    let outcome: RowOutcome;
    try {
      outcome = await processRow(row, fetchArtifact, kindOnly);
    } catch (error) {
      const failure = classifyRowError(row.id, error);
      result.failed += 1;
      result.failures.push(failure);
      if (!dryRun && !kindOnly) {
        // A marker write that itself fails must join the report rather than
        // abort the run: the batch-continuation contract (#953) covers the
        // write as much as the extraction, and an aborted run discards the
        // completion report the operator triages from.
        try {
          await client.libraryRecord.updateMany({
            where: { id: row.id, detailsStatus: CredentialDetailsStatus.EXTRACTION_PENDING },
            data: {
              detailsStatus: CredentialDetailsStatus.EXTRACTION_FAILED,
              detailsError: failure.errorClass,
            },
          });
        } catch (writeError) {
          result.failures.push(writeFailure(row.id, writeError));
        }
      }
      continue;
    }

    if (!dryRun) {
      try {
        const { count } =
          outcome.kind === 'core-kind'
            ? await client.libraryRecord.updateMany({
                where: { id: row.id, coreCredentialType: null },
                data: { coreCredentialType: outcome.coreCredentialType },
              })
            : await client.libraryRecord.updateMany({
                where: { id: row.id, detailsStatus: CredentialDetailsStatus.EXTRACTION_PENDING },
                data: {
                  ...outcome.details,
                  detailsStatus: CredentialDetailsStatus.EXTRACTED,
                  detailsError: null,
                  coreDataModelVersion: outcome.coreDataModelVersion,
                  coreCredentialType: outcome.coreCredentialType,
                },
              });
        if (count === 0) {
          // The row no longer matched: another run or an operator changed it
          // since it was read. Nothing of ours landed, so it is not counted
          // as a change, and the report says so.
          result.failed += 1;
          result.failures.push({
            id: row.id,
            errorClass: 'WRITE_FAILED',
            message: 'The record changed after it was read and was not written; re-run to pick it up',
          });
          continue;
        }
      } catch (writeError) {
        // The row stays as it was, so a re-run retries it; the report entry
        // is what tells the operator this pass did not land it.
        result.failed += 1;
        result.failures.push(writeFailure(row.id, writeError));
        continue;
      }
    }
    if (outcome.kind === 'core-kind') {
      result.coreKindsResolved += 1;
    } else {
      result.updated += 1;
    }
  }

  return result;
}

async function* eachPendingCredentialRow(client: BackfillClient): AsyncGenerator<PendingRecordRow> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await client.libraryRecord.findMany({
      where: {
        origin: LibraryRecordOrigin.NATIVE,
        OR: [{ detailsStatus: CredentialDetailsStatus.EXTRACTION_PENDING }, { coreCredentialType: null }],
        ...(cursor !== undefined && { id: { gt: cursor } }),
      },
      select: {
        id: true,
        detailsStatus: true,
        credentialType: true,
        coreCredentialType: true,
        coreDataModelVersion: true,
        credential: { select: { storageUri: true, decryptionKey: true } },
      },
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

type RowOutcome =
  | {
      kind: 'extracted';
      details: ReturnType<typeof extractCredentialDetails>;
      coreDataModelVersion: string;
      coreCredentialType: CoreCredentialType | null;
    }
  | { kind: 'core-kind'; coreCredentialType: CoreCredentialType };

/**
 * Reads one record's artefact. A row selected only for its unknown core
 * kind stops once the signed credential's type array has named it (ADR-053
 * decision 8): the bridge and the extractor are not consulted, because a
 * kind the artefact states plainly must not be withheld by a version the
 * registry does not know or a subject the bridge cannot read.
 */
async function processRow(
  row: PendingRecordRow,
  fetchArtifact: (uri: string) => Promise<string>,
  kindOnly: boolean,
): Promise<RowOutcome> {
  if (!row.credential) {
    throw new RowError(
      CredentialDetailsError.UNREADABLE_ENVELOPE,
      'The library record has no Credential row to read the artefact from',
    );
  }
  let bodyText: string;
  try {
    bodyText = await fetchArtifact(row.credential.storageUri);
  } catch (error) {
    if (error instanceof RowError) throw error;
    throw new RowError(CredentialDetailsError.UNREADABLE_ENVELOPE, errorMessage(error, 'Failed to fetch credential'), {
      cause: error,
    });
  }

  let fetched: unknown;
  try {
    fetched = JSON.parse(bodyText);
  } catch {
    throw new RowError(CredentialDetailsError.UNREADABLE_ENVELOPE, 'Response from storage URI is not valid JSON');
  }

  const credentialObject = unwrapToCredentialObject(fetched, row.credential.decryptionKey);

  let decoded: UNTPVerifiableCredential;
  try {
    const payload = decodeCredential(credentialObject as EnvelopedVerifiableCredential);
    if (payload === null || typeof payload !== 'object') {
      throw new Error('decoded payload is not an object');
    }
    decoded = payload;
  } catch (error) {
    if (error instanceof RowError) throw error;
    throw new RowError(
      CredentialDetailsError.UNREADABLE_ENVELOPE,
      errorMessage(error, 'Stored credential is not a decodable enveloped credential'),
      { cause: error },
    );
  }

  // The bridge is keyed by the core type. A row that already knows its core
  // kind names the bridge directly; otherwise the asserted type is tried as
  // written, which is right for a core credential and fails, as it always
  // did, for an extension whose core kind was never recorded.
  // A native record's kind came from the data model issuance resolved, the
  // most authoritative source there is (ADR-053 decision 8), so it stands.
  // Only a record that never learnt its kind reads the artefact's type set.
  const coreCredentialType = row.coreCredentialType ?? coreKindFromArtefact(decoded.type, row.credentialType, kindOnly);
  if (kindOnly && coreCredentialType !== null) {
    return { kind: 'core-kind', coreCredentialType };
  }
  if (coreCredentialType === null) {
    // Bridges are registered under the core names only, so without a core
    // kind there is no bridge to read the credential with.
    throw new RowError(
      CredentialDetailsError.BRIDGE_ERROR,
      row.credentialType
        ? `Neither the credential's type nor its asserted type (${row.credentialType}) names a core credential type, so no bridge can be chosen`
        : 'The record names no credential type to pick a bridge by',
    );
  }
  const bridgeType = bridgeNameOf(coreCredentialType);
  const coreDataModelVersion = resolveVersion(row, bridgeType, decoded);
  const bridge = getBridge(bridgeType, coreDataModelVersion);
  if (!bridge) {
    throw new RowError(
      CredentialDetailsError.BRIDGE_ERROR,
      `No bridge registered for ${bridgeType} v${coreDataModelVersion}`,
    );
  }

  try {
    return {
      kind: 'extracted',
      details: extractCredentialDetails(decoded, bridge),
      coreDataModelVersion,
      coreCredentialType,
    };
  } catch (error) {
    throw new RowError(
      CredentialDetailsError.BRIDGE_ERROR,
      errorMessage(error, 'Data-model bridge threw while reading the credential subject'),
      { cause: error },
    );
  }
}

function unwrapToCredentialObject(fetched: unknown, storedDecryptionKey: string | null): Record<string, unknown> {
  let credential: unknown = fetched;

  if (isEncryptedEnvelope(fetched)) {
    if (storedDecryptionKey === null) {
      throw new RowError(
        CredentialDetailsError.DECRYPT_FAILED,
        'Credential is encrypted but no decryption key is stored',
      );
    }
    if (!hasValidEnvelopeStructure(fetched)) {
      throw new RowError(
        CredentialDetailsError.UNREADABLE_ENVELOPE,
        'The stored credential data is corrupted and cannot be decrypted',
      );
    }

    let plaintextKey: string;
    try {
      const revealed = revealDecryptionKey(storedDecryptionKey);
      if (revealed === null) {
        throw new Error('stored decryption key is null');
      }
      plaintextKey = revealed;
    } catch (error) {
      throw new RowError(
        CredentialDetailsError.DECRYPT_FAILED,
        errorMessage(error, 'Failed to unwrap the stored decryption key'),
        { cause: error },
      );
    }

    let decryptedString: string;
    try {
      decryptedString = decryptCredential({
        cipherText: fetched.cipherText,
        key: plaintextKey,
        iv: fetched.iv,
        tag: fetched.tag,
        type: fetched.type,
      });
    } catch (error) {
      throw new RowError(
        CredentialDetailsError.DECRYPT_FAILED,
        errorMessage(error, 'The decryption key does not match this credential'),
        { cause: error },
      );
    }

    try {
      credential = JSON.parse(decryptedString);
    } catch {
      throw new RowError(
        CredentialDetailsError.UNREADABLE_ENVELOPE,
        'The credential was decrypted but its content is not valid JSON',
      );
    }
  }

  if (credential === null || typeof credential !== 'object' || Array.isArray(credential)) {
    throw new RowError(
      CredentialDetailsError.UNREADABLE_ENVELOPE,
      'Credential content from the storage URI is not a JSON object',
    );
  }

  return credential as Record<string, unknown>;
}

/**
 * The core kind for a record that never learnt one: the one core type the
 * artefact's type set names. A type set naming two core kinds is refused,
 * because no bridge can then be chosen (ADR-053 decision 8). A pending
 * extraction may still pick its bridge by the asserted type when that is a
 * core name, the rule issuance validated it under; a record selected only
 * for its unknown kind is filled from the signed type array alone, as the
 * ADR's 2026-09-03 update decides, and stays reported otherwise.
 */
function coreKindFromArtefact(
  types: unknown,
  assertedType: string | null,
  typeArrayOnly: boolean,
): CoreCredentialType | null {
  const fromTypes = coreCredentialTypeFromTypes(types);
  if (fromTypes === 'ambiguous') {
    throw new RowError(
      CredentialDetailsError.BRIDGE_ERROR,
      "The credential's type names more than one core credential type, so no bridge can be chosen",
    );
  }
  if (fromTypes !== 'none') return fromTypes;
  if (typeArrayOnly || !assertedType) return null;
  return coreCredentialTypeOf(assertedType) ?? null;
}

function resolveVersion(row: PendingRecordRow, bridgeType: string, decoded: UNTPVerifiableCredential): string {
  if (row.coreDataModelVersion) {
    return row.coreDataModelVersion;
  }

  const matches = versionsMatchingContext(bridgeType, decoded['@context']);
  if (matches.length === 0) {
    throw new RowError(
      CredentialDetailsError.BRIDGE_ERROR,
      `No registered bridge version for ${bridgeType} matched the credential @context`,
    );
  }
  if (matches.length > 1) {
    throw new RowError(
      CredentialDetailsError.BRIDGE_ERROR,
      `Ambiguous bridge version for ${bridgeType} from @context: ${matches.join(', ')}`,
    );
  }
  return matches[0];
}

function versionsMatchingContext(credentialType: string, context: unknown): string[] {
  const urls = contextUrls(context);
  return listRegisteredVersions(credentialType).filter((version) =>
    urls.some((url) => urlPathHasVersion(url, version)),
  );
}

function contextUrls(context: unknown): string[] {
  if (typeof context === 'string') {
    return [context];
  }
  if (Array.isArray(context)) {
    return context.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

/**
 * A version matches when it appears as a complete URL path segment, so
 * `0.6.0` does not match a `0.6.1` context URL.
 */
function urlPathHasVersion(url: string, version: string): boolean {
  try {
    return new URL(url).pathname.split('/').includes(version);
  } catch {
    return false;
  }
}

/** Stops a misbehaving storage response from exhausting the operator's process. */
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;

async function defaultFetchArtifact(uri: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(uri, { signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'TimeoutError'
        ? 'Failed to fetch credential: request timed out'
        : 'Failed to fetch credential: network error';
    throw new RowError(CredentialDetailsError.UNREADABLE_ENVELOPE, message, { cause: error });
  }

  if (!response.ok) {
    throw new RowError(
      CredentialDetailsError.UNREADABLE_ENVELOPE,
      `Failed to fetch credential: storage returned ${response.status}`,
    );
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ARTIFACT_BYTES) {
    throw new RowError(
      CredentialDetailsError.UNREADABLE_ENVELOPE,
      `Failed to fetch credential: response of ${declaredLength} bytes exceeds the ${MAX_ARTIFACT_BYTES}-byte limit`,
    );
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new RowError(CredentialDetailsError.UNREADABLE_ENVELOPE, 'Failed to read credential response', {
      cause: error,
    });
  }
  if (text.length > MAX_ARTIFACT_BYTES) {
    throw new RowError(
      CredentialDetailsError.UNREADABLE_ENVELOPE,
      `Failed to fetch credential: response exceeds the ${MAX_ARTIFACT_BYTES}-byte limit`,
    );
  }
  return text;
}

/** A failure marked on the row: its class is always one of the row's own. */
type ExtractionFailure = BackfillFailure & { errorClass: CredentialDetailsError };

function classifyRowError(id: string, error: unknown): ExtractionFailure {
  if (error instanceof RowError) {
    return { id, errorClass: error.errorClass, message: error.message };
  }
  return {
    id,
    errorClass: CredentialDetailsError.UNREADABLE_ENVELOPE,
    message: errorMessage(error, 'Credential backfill failed'),
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}
