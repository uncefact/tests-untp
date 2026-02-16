import { Credential, Prisma } from '../generated';
import { prisma } from '../prisma';

/**
 * Input for creating a new credential record
 */
export type CreateCredentialInput = {
  tenantId: string;
  storageUri: string;
  hash: string;
  decryptionKey?: string;
  credentialType: string;
  isPublished?: boolean;
};

/**
 * Options for listing credentials
 */
export type ListCredentialsOptions = {
  tenantId?: string;
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
      hash: input.hash,
      decryptionKey: input.decryptionKey,
      credentialType: input.credentialType,
      isPublished: input.isPublished ?? false,
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
 * Lists credentials with optional filtering and pagination
 */
export async function listCredentials(options: ListCredentialsOptions = {}): Promise<Credential[]> {
  const { tenantId, credentialType, isPublished, limit, offset } = options;

  const where: Prisma.CredentialWhereInput = {};

  if (tenantId !== undefined) {
    where.tenantId = tenantId;
  }

  if (credentialType !== undefined) {
    where.credentialType = credentialType;
  }

  if (isPublished !== undefined) {
    where.isPublished = isPublished;
  }

  return prisma.credential.findMany({
    where,
    take: limit,
    skip: offset,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Updates the published status of a credential
 */
export async function updateCredentialPublished(id: string, isPublished: boolean): Promise<Credential> {
  return prisma.credential.update({
    where: { id },
    data: { isPublished },
  });
}
