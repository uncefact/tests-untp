import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import { LibraryRecordOrigin, CheckRunState } from '@/lib/prisma/generated';
import {
  CredentialDocumentFetchError,
  fetchCredentialDocument,
  type FetchedDocument,
} from '@/lib/credentials/fetch-credential-document';
import { NotFoundError } from '@/lib/api/errors';
import { apiLogger } from '@/lib/api/logger';
import { getLibraryRecordById } from '@/lib/prisma/repositories/library-record.repository';
import { LibraryRecordShapeError, type LibraryRecordDetailView } from '@/lib/library/library-record-view';
import {
  createReverificationGeneration,
  type CreateReverificationGenerationInput,
  type CreateReverificationGenerationResult,
  type ReverificationCustodySnapshot,
  type SourceFreshness,
} from '@/lib/prisma/repositories/check-run.repository';
import type { SqlExecutor } from '@/lib/jobs/types';
import type { VerifyJobReference } from '@/lib/prisma/repositories/external-credential.repository';

const logger = apiLogger.child({ module: 'reverify-library-record' });

export class ReverifyBranchNotBuiltError extends Error {
  constructor(recordId: string) {
    super(`External re-verification without a durable copy is not built for library record ${recordId}`);
    this.name = 'ReverifyBranchNotBuiltError';
  }
}

export class DecryptionRequiredError extends Error {
  readonly code = 'DECRYPTION_REQUIRED';

  constructor() {
    super(
      "This service holds no usable key for the record's durable copy. Re-verification with a caller-supplied key is not supported yet.",
    );
    this.name = 'DecryptionRequiredError';
  }
}

export type ReverifyLibraryRecordDependencies = {
  getRecord: (recordId: string, tenantId: string) => Promise<LibraryRecordDetailView | null>;
  fetchSource: (href: string) => Promise<FetchedDocument>;
  createGeneration: (input: CreateReverificationGenerationInput) => Promise<CreateReverificationGenerationResult>;
};

export function defaultReverifyLibraryRecordDependencies(): ReverifyLibraryRecordDependencies {
  return {
    getRecord: getLibraryRecordById,
    fetchSource: (href) => fetchCredentialDocument(href),
    createGeneration: createReverificationGeneration,
  };
}

export type ReverifyLibraryRecordResult = CreateReverificationGenerationResult;

/** Places the verification job on the queue, inside the transaction that creates the generation. */
export type EnqueueVerification = (sql: SqlExecutor, job: VerifyJobReference) => Promise<void>;

/**
 * Readies whatever the enqueue needs, and is called only once this module has
 * decided a generation will be created. A caller that has to start a queue
 * does it here rather than before the record is read, so an unavailable queue
 * cannot turn a not-found, a join or a refusal into a server error.
 */
export type PrepareEnqueue = () => Promise<EnqueueVerification>;

/**
 * Decides what a bodyless re-verification does with a record, prepares the
 * in-request work, and asks the repository to lock, recheck and append the
 * generation.
 *
 * This is the only owner of the precedence a caller sees: the record must
 * exist under the tenant, a pending generation is joined rather than
 * duplicated, and an external record is refused when the branch its stored
 * custody implies is unavailable. The route reads the request and projects
 * the answer, and repeats none of these decisions.
 *
 * The worker owns every read of the pinned copy. The protected external
 * branch only checks the supplier source here, and never replaces the copy.
 *
 * `prepareEnqueue` runs only once a generation is going to be created, so a
 * caller whose queue will not start still answers a not-found, a join and a
 * key refusal exactly as it would with a healthy queue.
 */
export async function reverifyLibraryRecord(
  recordId: string,
  tenantId: string,
  prepareEnqueue: PrepareEnqueue,
  deps: ReverifyLibraryRecordDependencies = defaultReverifyLibraryRecordDependencies(),
): Promise<ReverifyLibraryRecordResult> {
  const current = await deps.getRecord(recordId, tenantId);
  if (current === null) throw new NotFoundError('No such credential record.', 'NOT_FOUND');

  const log = logger.child({ recordId, tenantId, origin: originOf(current) });
  log.info('Re-verification entered');
  if (current.checkRun?.state === CheckRunState.PENDING) {
    log.info({ generation: current.checkRun.generation }, 'Re-verification joined pending generation');
    return { outcome: 'joined' };
  }

  const common = { recordId, tenantId, expectedCustody: custodyOf(current) };

  if (current.origin === LibraryRecordOrigin.NATIVE) {
    // Generation 1 of a native record is its issuance assertion whether or not
    // a run was ever stored, so the first executed generation is 2.
    return recorded(
      log,
      await deps.createGeneration({
        ...common,
        expectedOrigin: LibraryRecordOrigin.NATIVE,
        expectedGeneration: current.checkRun?.generation ?? 1,
        enqueue: await prepareEnqueue(),
      }),
    );
  }

  const external = current.external;
  if (external.storageUri === null) {
    throw new ReverifyBranchNotBuiltError(recordId);
  }
  if (external.decryptionKey === null) {
    if (external.encrypted === true) throw new DecryptionRequiredError();
    throw new LibraryRecordShapeError(recordId, 'holds a stored copy that is neither encrypted nor keyed');
  }
  if (external.encrypted === null) {
    throw new LibraryRecordShapeError(
      recordId,
      'holds a key for a stored copy that does not say whether it is encrypted',
    );
  }
  if (external.sourceUrl === null || external.sourceDigest === null) {
    throw new LibraryRecordShapeError(recordId, 'holds a stored copy with no source provenance to compare against');
  }

  const freshness = await checkSourceFreshness(log, external.sourceUrl, external.sourceDigest, deps.fetchSource);
  return recorded(
    log,
    await deps.createGeneration({
      ...common,
      expectedOrigin: LibraryRecordOrigin.EXTERNAL,
      expectedGeneration: current.checkRun.generation,
      freshness,
      enqueue: await prepareEnqueue(),
    }),
  );
}

function recorded(
  log: typeof logger,
  result: CreateReverificationGenerationResult,
): CreateReverificationGenerationResult {
  log.info(
    { outcome: result.outcome, generation: 'generation' in result ? result.generation : null },
    'Re-verification generation decision recorded',
  );
  return result;
}

function originOf(record: LibraryRecordDetailView): 'native' | 'external' {
  return record.origin === LibraryRecordOrigin.NATIVE ? 'native' : 'external';
}

function custodyOf(record: LibraryRecordDetailView): ReverificationCustodySnapshot {
  if (record.origin === LibraryRecordOrigin.NATIVE) {
    return {
      storageUri: record.credential.storageUri,
      storageDigestMultibase: record.credential.digestMultibase,
      storageExternalId: null,
    };
  }
  return {
    storageUri: record.external.storageUri,
    storageDigestMultibase: record.external.storageDigestMultibase,
    storageExternalId: record.external.storageExternalId,
  };
}

/**
 * Compares the supplier source against the digest the register recorded for
 * the pinned copy. Neither the copy nor that digest is written here.
 *
 * A source that cannot be read answers `sourceChanged: null` with the
 * timestamp still set, which is the wire contract's "a comparison was
 * attempted and could not be completed". Only the fetch is caught: a fault in
 * our own digest handling is not a statement about the supplier's server, so
 * it propagates and the request fails instead.
 */
async function checkSourceFreshness(
  log: typeof logger,
  sourceUrl: string,
  sourceDigest: string,
  fetchSource: (href: string) => Promise<FetchedDocument>,
): Promise<SourceFreshness> {
  const checkedAt = new Date(Date.now());
  let document: FetchedDocument;
  try {
    document = await fetchSource(sourceUrl);
  } catch (error) {
    if (error instanceof CredentialDocumentFetchError) {
      log.warn({ outcome: 'not_checked', reason: error.failure.reason }, 'Source freshness could not be checked');
    } else {
      // Guard rejections, DNS faults, timeouts and bad statuses all arrive
      // typed above. What reaches here is an internal fault, which is the
      // case that most needs its cause in the log.
      log.warn({ err: error, outcome: 'not_checked' }, 'Source freshness could not be checked');
    }
    return { sourceChanged: null, checkedAt };
  }
  // Checked through the recorded digest itself, so the algorithm and base are
  // read off the value the register wrote rather than restated here. Restating
  // them would report every source as changed the day either one moved.
  const unchanged = await MultibaseDigest.fromString(sourceDigest).verify(document.bytes);
  log.info({ outcome: unchanged ? 'unchanged' : 'changed' }, 'Source freshness checked');
  return { sourceChanged: !unchanged, checkedAt };
}
