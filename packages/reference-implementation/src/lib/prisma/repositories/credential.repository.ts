import { Credential, Prisma } from '../generated';
import { prisma } from '../prisma';

/**
 * Input for creating a new credential record
 */
export type CreateCredentialInput = {
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
export async function getCredentialById(id: string): Promise<Credential | null> {
  return prisma.credential.findUnique({
    where: { id },
  });
}

/**
 * Lists credentials with optional filtering and pagination
 */
export async function listCredentials(options: ListCredentialsOptions = {}): Promise<Credential[]> {
  const { credentialType, isPublished, limit, offset } = options;

  const where: Prisma.CredentialWhereInput = {};

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
