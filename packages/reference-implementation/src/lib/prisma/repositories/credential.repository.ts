import { isForeignKeyViolationOn } from '@/lib/prisma/db-errors';
import { Credential, Prisma } from '../generated';
import { prisma } from '../prisma';
import { mapDatabaseError } from '@/lib/prisma/db-errors';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';

/**
 * Input for creating a new credential record
 */
export type CreateCredentialInput = {
  tenantId: string;
  storageUri: string;
  digestMultibase: string;
  decryptionKey?: string;
  credentialType: string;
  isPublished?: boolean;
  organisationId?: string;
  facilityId?: string;
  productId?: string;
};

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

/**
 * Creates a new credential record.
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
 * server-failure path.
 */
export async function createCredential(
  input: CreateCredentialInput,
): Promise<{ credential: Credential; entityLinkFailed: boolean }> {
  const data = {
    tenantId: input.tenantId,
    storageUri: input.storageUri,
    digestMultibase: input.digestMultibase,
    decryptionKey: input.decryptionKey,
    credentialType: input.credentialType,
    isPublished: input.isPublished ?? false,
  };

  try {
    const credential = await prisma.credential.create({
      data: {
        ...data,
        organisationId: input.organisationId,
        facilityId: input.facilityId,
        productId: input.productId,
      },
    });
    return { credential, entityLinkFailed: false };
  } catch (error) {
    const onEntityColumn = ['organisationId', 'facilityId', 'productId'].some((column) =>
      isForeignKeyViolationOn(error, column),
    );
    if (!onEntityColumn) throw error;
    const credential = await prisma.credential.create({ data });
    return { credential, entityLinkFailed: true };
  }
}

/**
 * Retrieves a credential by its ID
 */
export async function getCredentialById(id: string, tenantId: string): Promise<Credential | null> {
  return prisma.credential.findFirst({
    where: { id, tenantId },
  });
}

/**
 * Lists credentials with optional filtering and pagination.
 * Returns matching records alongside the total count for the filter
 * criteria (via a parallel count query).
 */
export async function listCredentials(options: ListCredentialsOptions): Promise<{ data: Credential[]; total: number }> {
  const { tenantId, credentialType, isPublished, limit, offset } = options;

  const where: Prisma.CredentialWhereInput = { tenantId };

  if (credentialType !== undefined) {
    where.credentialType = credentialType;
  }

  if (isPublished !== undefined) {
    where.isPublished = isPublished;
  }

  const [data, total] = await Promise.all([
    prisma.credential.findMany({
      where,
      take: limit ?? DEFAULT_PAGE_LIMIT,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.credential.count({ where }),
  ]);

  return { data, total };
}

/**
 * Updates the published status of a credential
 */
export async function updateCredentialPublished(
  id: string,
  tenantId: string,
  isPublished: boolean,
): Promise<Credential> {
  try {
    return await prisma.credential.update({
      where: { id, tenantId },
      data: { isPublished },
    });
  } catch (e) {
    mapDatabaseError(e, { notFound: 'Credential not found' });
  }
}
