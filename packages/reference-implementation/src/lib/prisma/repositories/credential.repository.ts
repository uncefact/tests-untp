import { Credential, Prisma } from '../generated';
import { prisma } from '../prisma';

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
 * Creates a new credential record
 */
export async function createCredential(input: CreateCredentialInput): Promise<Credential> {
  return prisma.credential.create({
    data: {
      tenantId: input.tenantId,
      storageUri: input.storageUri,
      digestMultibase: input.digestMultibase,
      decryptionKey: input.decryptionKey,
      credentialType: input.credentialType,
      isPublished: input.isPublished ?? false,
      organisationId: input.organisationId,
      facilityId: input.facilityId,
      productId: input.productId,
    },
  });
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
      take: limit,
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
  return prisma.credential.update({
    where: { id, tenantId },
    data: { isPublished },
  });
}
