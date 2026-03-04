import { Did, DidStatus, Prisma } from '../generated';
import { prisma } from '../prisma';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';

/**
 * Input for creating a new DID record
 */
export type CreateDidInput = {
  tenantId: string;
  did: string;
  type: 'DEFAULT' | 'MANAGED' | 'SELF_MANAGED';
  method?: 'DID_WEB' | 'DID_WEB_VH';
  keyId: string;
  name?: string;
  description?: string;
  isDefault?: boolean;
  status?: 'ACTIVE' | 'INACTIVE' | 'VERIFIED' | 'UNVERIFIED' | 'VERIFICATION_FAILED';
  serviceInstanceId?: string;
};

/**
 * Input for updating a DID record
 */
export type UpdateDidInput = {
  name?: string;
  description?: string;
  isDefault?: boolean;
};

/**
 * Options for listing DIDs
 */
export type ListDidsOptions = {
  type?: 'DEFAULT' | 'MANAGED' | 'SELF_MANAGED';
  status?: 'ACTIVE' | 'INACTIVE' | 'VERIFIED' | 'UNVERIFIED' | 'VERIFICATION_FAILED';
  serviceInstanceId?: string;
  limit?: number;
  offset?: number;
};

/**
 * Creates a new DID record scoped to an organisation
 */
export async function createDid(input: CreateDidInput): Promise<Did> {
  return prisma.did.create({
    data: {
      tenantId: input.tenantId,
      did: input.did,
      type: input.type,
      method: input.method ?? 'DID_WEB',
      keyId: input.keyId,
      name: input.name ?? input.did,
      description: input.description,
      isDefault: input.isDefault ?? false,
      status: input.status ?? 'UNVERIFIED',
      serviceInstanceId: input.serviceInstanceId,
    },
  });
}

/**
 * Retrieves a DID by ID, scoped to an organisation.
 * Returns null if the DID does not exist or belongs to a different organisation.
 */
export async function getDidById(id: string, tenantId: string): Promise<Did | null> {
  return prisma.did.findFirst({
    where: {
      id,
      OR: [{ tenantId }, { isDefault: true, type: 'DEFAULT' }],
    },
  });
}

/**
 * Retrieves a DID by its DID string (e.g. "did:web:example.com"), scoped to an organisation.
 * Also returns system default DIDs regardless of tenant. Returns null if the DID
 * does not exist or belongs to a different non-default organisation.
 */
export async function getDidByDid(did: string, tenantId: string): Promise<Did | null> {
  return prisma.did.findFirst({
    where: {
      did,
      OR: [{ tenantId }, { isDefault: true, type: 'DEFAULT' }],
    },
  });
}

/**
 * Lists DIDs for an organisation, including system defaults.
 * Returns the matching records along with the total count for pagination.
 */
export async function listDids(
  tenantId: string,
  options: ListDidsOptions = {},
): Promise<{ data: Did[]; total: number }> {
  const { type, status, serviceInstanceId, limit, offset } = options;

  const where: Prisma.DidWhereInput = {
    OR: [{ tenantId }, { isDefault: true, type: 'DEFAULT' }],
  };

  if (type !== undefined) {
    where.type = type;
  }

  if (status !== undefined) {
    where.status = status;
  }

  if (serviceInstanceId !== undefined) {
    where.serviceInstanceId = serviceInstanceId;
  }

  const [data, total] = await Promise.all([
    prisma.did.findMany({
      where,
      take: limit ?? 20,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.did.count({ where }),
  ]);

  return { data, total };
}

/**
 * Updates a DID's name, description, and/or default status.
 * Validates that the DID belongs to the specified organisation.
 * When setting isDefault to true, clears any existing tenant default
 * (excluding system DEFAULT type DIDs) within the same transaction.
 */
export async function updateDid(id: string, tenantId: string, input: UpdateDidInput): Promise<Did> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.did.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('DID not found or access denied');
    }

    if (input.isDefault !== undefined && existing.type === 'DEFAULT') {
      throw new ValidationError('Cannot modify default status of system DIDs');
    }

    if (input.isDefault) {
      await tx.did.updateMany({
        where: {
          tenantId: existing.tenantId,
          isDefault: true,
          id: { not: id },
          type: { not: 'DEFAULT' },
        },
        data: { isDefault: false },
      });
    }

    return tx.did.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
      },
    });
  });
}

/**
 * Updates a DID's status (used for verification flow).
 * Validates that the DID belongs to the specified organisation.
 */
export async function updateDidStatus(id: string, tenantId: string, status: DidStatus): Promise<Did> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.did.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('DID not found or access denied');
    }

    return tx.did.update({
      where: { id },
      data: { status },
    });
  });
}

/**
 * Deletes a DID.
 * Validates that the DID exists and belongs to the specified organisation.
 */
export async function deleteDid(id: string, tenantId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.did.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('DID not found or access denied');
    }

    await tx.did.delete({
      where: { id },
    });
  });
}

/**
 * Returns the system default DID (if seeded).
 */
export async function getDefaultDid(): Promise<Did | null> {
  return prisma.did.findFirst({
    where: { isDefault: true },
  });
}
