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
import { CredentialDetailsError, CredentialDetailsStatus } from '../prisma/generated';
import { extractCredentialDetails } from './extract-credential-details';
import { revealDecryptionKey } from './decryption-key-protection';

const BATCH_SIZE = 100;

export type BackfillFailure = {
  id: string;
  errorClass: CredentialDetailsError;
  message: string;
};

export type BackfillCredentialDetailsResult = {
  dryRun: boolean;
  scanned: number;
  updated: number;
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

type PendingCredentialRow = {
  id: string;
  storageUri: string;
  decryptionKey: string | null;
  credentialType: string;
  coreDataModelVersion: string | null;
};

/**
 * The subset of the Prisma client the backfill needs. Structural so tests can
 * supply an in-memory fake.
 */
export type BackfillClient = {
  credential: {
    findMany(args: {
      where: { detailsStatus: typeof CredentialDetailsStatus.EXTRACTION_PENDING; id?: { gt: string } };
      select: {
        id: true;
        storageUri: true;
        decryptionKey: true;
        credentialType: true;
        coreDataModelVersion: true;
      };
      orderBy: { id: 'asc' };
      take: number;
    }): Promise<PendingCredentialRow[]>;
    updateMany(args: {
      where: { id: string; detailsStatus: typeof CredentialDetailsStatus.EXTRACTION_PENDING };
      data: {
        name?: string | null;
        issuerName?: string | null;
        issuerDid?: string | null;
        subjectName?: string | null;
        subjectId?: string | null;
        validFrom?: Date | null;
        validUntil?: Date | null;
        detailsStatus: CredentialDetailsStatus;
        detailsError?: CredentialDetailsError | null;
        coreDataModelVersion?: string | null;
      };
    }): Promise<{ count: number }>;
  };
};

function writeFailure(id: string, error: unknown): BackfillFailure {
  const message = error instanceof Error ? error.message : String(error);
  return {
    id,
    errorClass: CredentialDetailsError.UNREADABLE_ENVELOPE,
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
 * artefact, so it is not part of startup. Re-running converges. Rows already
 * `EXTRACTED` or `EXTRACTION_FAILED` are not selected. A dry run performs the
 * same per-row work without writing.
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
    failed: 0,
    failures: [],
  };

  for await (const row of eachPendingCredentialRow(client)) {
    result.scanned += 1;
    let outcome: Awaited<ReturnType<typeof processRow>>;
    try {
      outcome = await processRow(row, fetchArtifact);
    } catch (error) {
      const failure = classifyRowError(row.id, error);
      result.failed += 1;
      result.failures.push(failure);
      if (!dryRun) {
        // A marker write that itself fails must join the report rather than
        // abort the run: the batch-continuation contract (#953) covers the
        // write as much as the extraction, and an aborted run discards the
        // completion report the operator triages from.
        try {
          await client.credential.updateMany({
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
        await client.credential.updateMany({
          where: { id: row.id, detailsStatus: CredentialDetailsStatus.EXTRACTION_PENDING },
          data: {
            ...outcome.details,
            detailsStatus: CredentialDetailsStatus.EXTRACTED,
            detailsError: null,
            coreDataModelVersion: outcome.coreDataModelVersion,
          },
        });
      } catch (writeError) {
        // The row stays EXTRACTION_PENDING, so a re-run retries it; the
        // report entry is what tells the operator this pass did not land it.
        result.failed += 1;
        result.failures.push(writeFailure(row.id, writeError));
        continue;
      }
    }
    result.updated += 1;
  }

  return result;
}

async function* eachPendingCredentialRow(client: BackfillClient): AsyncGenerator<PendingCredentialRow> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await client.credential.findMany({
      where: {
        detailsStatus: CredentialDetailsStatus.EXTRACTION_PENDING,
        ...(cursor !== undefined && { id: { gt: cursor } }),
      },
      select: {
        id: true,
        storageUri: true,
        decryptionKey: true,
        credentialType: true,
        coreDataModelVersion: true,
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

async function processRow(
  row: PendingCredentialRow,
  fetchArtifact: (uri: string) => Promise<string>,
): Promise<{ details: ReturnType<typeof extractCredentialDetails>; coreDataModelVersion: string }> {
  let bodyText: string;
  try {
    bodyText = await fetchArtifact(row.storageUri);
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

  const credentialObject = unwrapToCredentialObject(fetched, row.decryptionKey);

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

  const coreDataModelVersion = resolveVersion(row, decoded);
  const bridge = getBridge(row.credentialType, coreDataModelVersion);
  if (!bridge) {
    throw new RowError(
      CredentialDetailsError.BRIDGE_ERROR,
      `No bridge registered for ${row.credentialType} v${coreDataModelVersion}`,
    );
  }

  try {
    return { details: extractCredentialDetails(decoded, bridge), coreDataModelVersion };
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

function resolveVersion(row: PendingCredentialRow, decoded: UNTPVerifiableCredential): string {
  if (row.coreDataModelVersion) {
    return row.coreDataModelVersion;
  }

  const matches = versionsMatchingContext(row.credentialType, decoded['@context']);
  if (matches.length === 0) {
    throw new RowError(
      CredentialDetailsError.BRIDGE_ERROR,
      `No registered bridge version for ${row.credentialType} matched the credential @context`,
    );
  }
  if (matches.length > 1) {
    throw new RowError(
      CredentialDetailsError.BRIDGE_ERROR,
      `Ambiguous bridge version for ${row.credentialType} from @context: ${matches.join(', ')}`,
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

function classifyRowError(id: string, error: unknown): BackfillFailure {
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
