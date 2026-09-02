import { isForeignKeyViolationOn } from '@/lib/prisma/db-errors';
import {
  CredentialDetailsError,
  CredentialDetailsStatus,
  LibraryRecordOrigin,
  type CoreCredentialType,
  type Credential,
  type LibraryRecord,
  type Prisma,
} from '../generated';
import { prisma } from '../prisma';
import { linkClaimToRecord } from './idempotency-key.repository';
import { mapDatabaseError } from '@/lib/prisma/db-errors';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';
import type { CredentialDetails } from '@/lib/credentials/extract-credential-details';

/**
 * A native credential as its callers see it: the `Credential` child row
 * with its library record's shared fields (the type, the extracted
 * descriptive fields and their status) flattened onto it, so a reader does
 * not have to know the record is two rows (ADR-053 decisions 1 and 5).
 */
export type CredentialRecord = Omit<Credential, 'origin'> &
  Pick<
    LibraryRecord,
    | 'credentialType'
    | 'coreCredentialType'
    | 'coreDataModelVersion'
    | 'name'
    | 'issuerName'
    | 'issuerDid'
    | 'subjectName'
    | 'subjectId'
    | 'validFrom'
    | 'validUntil'
    | 'detailsStatus'
    | 'detailsError'
  >;

/**
 * Input for creating a new credential record
 */
export type CreateCredentialInput = {
  tenantId: string;
  storageUri: string;
  digestMultibase: string;
  decryptionKey?: string;
  /** The type issuance was asked for: an extension's own name when it is one. */
  credentialType: string;
  /** The core kind the type resolves to (ADR-053 decision 8); null when unknown. */
  coreCredentialType?: CoreCredentialType | null;
  coreDataModelVersion: string;
  isPublished?: boolean;
  organisationId?: string;
  facilityId?: string;
  productId?: string;
  /**
   * When set, the record and this claim are written in one transaction so a
   * crash cannot leave a minted credential that a stale reclaim would issue
   * again (#954).
   */
  idempotencyClaimId?: string;
} & CredentialDetailsInput;

/**
 * The outcome of reading a signed credential's descriptive fields (#952).
 *
 * The three branches are the only rows that make sense, so a half-written one
 * cannot be expressed. Fields without `EXTRACTED` would leave a populated row
 * claiming its details had never been read; `EXTRACTED` without fields would
 * claim a read that never happened; and a failure carries the reason that says
 * what a later run should do about it. Passing none of them leaves the columns
 * null, with `detailsStatus` at its database default of `EXTRACTION_PENDING`.
 */
export type CredentialDetailsInput =
  | { details: CredentialDetails; detailsStatus: typeof CredentialDetailsStatus.EXTRACTED; detailsError?: undefined }
  | {
      details?: undefined;
      detailsStatus: typeof CredentialDetailsStatus.EXTRACTION_FAILED;
      detailsError: CredentialDetailsError;
    }
  | { details?: undefined; detailsStatus?: undefined; detailsError?: undefined };

/**
 * Options for listing credentials
 */
export type ListCredentialsOptions = {
  tenantId: string;
  credentialType?: string;
  isPublished?: boolean;
  limit?: number;
  offset?: number;
};

type CredentialWithRecord = Credential & { record: LibraryRecord };

/** Flattens the parent's shared fields onto the child row. */
export function flattenCredential(row: CredentialWithRecord): CredentialRecord {
  // The child's origin column exists for the database's parent/child
  // constraints; a native credential's reader gains nothing from it.
  const { record, origin: _origin, ...credential } = row;
  return {
    ...credential,
    credentialType: record.credentialType,
    coreCredentialType: record.coreCredentialType,
    coreDataModelVersion: record.coreDataModelVersion,
    name: record.name,
    issuerName: record.issuerName,
    issuerDid: record.issuerDid,
    subjectName: record.subjectName,
    subjectId: record.subjectId,
    validFrom: record.validFrom,
    validUntil: record.validUntil,
    detailsStatus: record.detailsStatus,
    detailsError: record.detailsError,
    // Both timestamps are the parent's (ADR-053 decision 1): the record was
    // created when its parent row was, and a details backfill moves the
    // last-modified time while a key rewrap on the child does not.
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Creates a native credential: its library record and its `Credential` child
 * in one transaction (ADR-053 decision 1), with the captured descriptive
 * fields on the record (decision 5).
 *
 * Entity links are optional enrichment (ADR-044): the server picks the entity
 * on the caller's behalf, and by the time this runs the credential has already
 * been signed and stored externally, so an entity that vanished between the
 * lookup and this write must not destroy work that succeeded. A foreign-key
 * violation on one of the three entity columns is retried once without any of
 * them and reported through `entityLinkFailed` (a credential carries at most
 * one entity link, since the publish target is a single chosen reference); every other database failure,
 * including a violation on `tenantId`, stays fatal and is translated by
 * ADR-036's mapping. This is the carve-out ADR-044 makes to ADR-042, which
 * otherwise routes a vanished server-selected dependency to the sanitised
 * server-failure path. When `idempotencyClaimId` is set and the association
 * matches no row, throws `IdempotencyClaimLostError` inside the transaction
 * so both rows are rolled back (#954).
 */
export async function createCredential(
  input: CreateCredentialInput,
): Promise<{ credential: CredentialRecord; entityLinkFailed: boolean }> {
  // One instant for every timestamp the two rows carry, so the record can
  // never read as updated before it was created.
  const now = new Date();
  const recordData = {
    tenantId: input.tenantId,
    origin: LibraryRecordOrigin.NATIVE,
    createdAt: now,
    updatedAt: now,
    credentialType: input.credentialType,
    coreCredentialType: input.coreCredentialType ?? null,
    coreDataModelVersion: input.coreDataModelVersion,
    ...input.details,
    detailsStatus: input.detailsStatus,
    detailsError: input.detailsError,
  };
  const childData = {
    tenantId: input.tenantId,
    createdAt: now,
    updatedAt: now,
    storageUri: input.storageUri,
    digestMultibase: input.digestMultibase,
    decryptionKey: input.decryptionKey,
    isPublished: input.isPublished ?? false,
  };
  const linkedChildData = {
    ...childData,
    organisationId: input.organisationId,
    facilityId: input.facilityId,
    productId: input.productId,
  };

  const persist = async (tx: Prisma.TransactionClient, withLinks: boolean) => {
    const record = await tx.libraryRecord.create({ data: recordData });
    const credential = await tx.credential.create({
      data: { id: record.id, ...(withLinks ? linkedChildData : childData) },
    });
    if (input.idempotencyClaimId) {
      await linkClaimToRecord(tx, input.idempotencyClaimId, record.id);
    }
    return flattenCredential({ ...credential, record });
  };

  const run = (withLinks: boolean) => prisma.$transaction((tx) => persist(tx, withLinks));

  try {
    const credential = await run(true);
    return { credential, entityLinkFailed: false };
  } catch (error) {
    const onEntityColumn = ['organisationId', 'facilityId', 'productId'].some((column) =>
      isForeignKeyViolationOn(error, column),
    );
    // A unique-constraint conflict is the caller's 409 (ADR-036). A foreign
    // key that fails on anything but an entity link (the tenant, say) is a
    // real failure and stays fatal.
    if (!onEntityColumn) mapDatabaseError(error, { conflict: 'A credential record with this identity already exists' });
    const credential = await run(false);
    return { credential, entityLinkFailed: true };
  }
}

/**
 * Retrieves a credential by its ID
 */
export async function getCredentialById(id: string, tenantId: string): Promise<CredentialRecord | null> {
  const row = await prisma.credential.findFirst({
    where: { id, tenantId },
    include: { record: true },
  });
  return row ? flattenCredential(row) : null;
}

/**
 * Lists credentials with optional filtering and pagination.
 * Returns matching records alongside the total count for the filter
 * criteria (via a parallel count query).
 */
export async function listCredentials(
  options: ListCredentialsOptions,
): Promise<{ data: CredentialRecord[]; total: number }> {
  const { tenantId, credentialType, isPublished, limit, offset } = options;

  const where: Prisma.CredentialWhereInput = { tenantId };

  if (credentialType !== undefined) {
    where.record = { credentialType };
  }

  if (isPublished !== undefined) {
    where.isPublished = isPublished;
  }

  const [rows, total] = await Promise.all([
    prisma.credential.findMany({
      where,
      include: { record: true },
      take: limit ?? DEFAULT_PAGE_LIMIT,
      skip: offset,
      // Ordered by the timestamp the response carries, the parent's, with the
      // id as a tie-break so a page boundary is stable.
      orderBy: [{ record: { createdAt: 'desc' } }, { id: 'desc' }],
    }),
    prisma.credential.count({ where }),
  ]);

  return { data: rows.map(flattenCredential), total };
}

/**
 * Updates the published status of a credential
 */
export async function updateCredentialPublished(
  id: string,
  tenantId: string,
  isPublished: boolean,
): Promise<CredentialRecord> {
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.credential.update({
        where: { id, tenantId },
        data: { isPublished },
        include: { record: true },
      });
      // A publication flag is a change to the record, and the parent's
      // updatedAt is the record's last-modified time (ADR-053 decision 1).
      const record = await tx.libraryRecord.update({
        where: { id_tenantId: { id: row.id, tenantId } },
        data: { updatedAt: new Date() },
      });
      return flattenCredential({ ...row, record });
    });
  } catch (e) {
    mapDatabaseError(e, { notFound: 'Credential not found' });
  }
}
