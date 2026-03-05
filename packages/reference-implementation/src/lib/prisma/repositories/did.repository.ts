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
 * Creates a new DID record scoped to an organisation.
 * When isDefault is true, clears any existing tenant default
 * (excluding system DEFAULT type DIDs) within a transaction.
 */
export async function createDid(input: CreateDidInput): Promise<Did> {
  const data = {
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
  };

  if (input.isDefault) {
    return prisma.$transaction(async (tx) => {
      await tx.did.updateMany({
        where: {
          tenantId: input.tenantId,
          isDefault: true,
          type: { not: 'DEFAULT' },
        },
        data: { isDefault: false },
      });
      return tx.did.create({ data });
    });
  }

  return prisma.did.create({ data });
}

/**
 * Retrieves a DID by ID, scoped to an organisation.
 * Returns null if the DID does not exist or belongs to a different organisation.
 * If the fetched DID is a system DEFAULT with isDefault true, checks whether the
 * tenant has their own default set and overrides isDefault to false if so.
 */
export async function getDidById(id: string, tenantId: string): Promise<Did | null> {
  const did = await prisma.did.findFirst({
    where: {
      id,
      OR: [{ tenantId }, { isDefault: true, type: 'DEFAULT' }],
    },
  });

  if (did?.type === 'DEFAULT' && did.isDefault) {
    const tenantDefault = await prisma.did.findFirst({
      where: { tenantId, isDefault: true, type: { not: 'DEFAULT' } },
    });
    if (tenantDefault) {
      return { ...did, isDefault: false };
    }
  }

  return did;
}

/**
 * Retrieves a DID by its DID string (e.g. "did:web:example.com"), scoped to an organisation.
 * Also returns system default DIDs regardless of tenant. Returns null if the DID
 * does not exist or belongs to a different non-default organisation.
 * If the fetched DID is a system DEFAULT with isDefault true, checks whether the
 * tenant has their own default set and overrides isDefault to false if so.
 */
export async function getDidByDid(didString: string, tenantId: string): Promise<Did | null> {
  const did = await prisma.did.findFirst({
    where: {
      did: didString,
      OR: [{ tenantId }, { isDefault: true, type: 'DEFAULT' }],
    },
  });

  if (did?.type === 'DEFAULT' && did.isDefault) {
    const tenantDefault = await prisma.did.findFirst({
      where: { tenantId, isDefault: true, type: { not: 'DEFAULT' } },
    });
    if (tenantDefault) {
      return { ...did, isDefault: false };
    }
  }

  return did;
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

  // If the tenant has set their own default, override the system DID's isDefault
  const tenantHasDefault = data.some((d) => d.isDefault && d.type !== 'DEFAULT');
  if (tenantHasDefault) {
    for (const d of data) {
      if (d.type === 'DEFAULT' && d.isDefault) {
        d.isDefault = false;
      }
    }
  }

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
 * Returns the default DID. When a tenantId is provided, prefers the tenant's
 * own default DID over the system default. Falls back to the system default
 * if the tenant has no default set.
 */
export async function getDefaultDid(tenantId?: string): Promise<Did | null> {
  if (tenantId) {
    const tenantDefault = await prisma.did.findFirst({
      where: { tenantId, isDefault: true, type: { not: 'DEFAULT' } },
    });
    if (tenantDefault) return tenantDefault;
  }
  return prisma.did.findFirst({
    where: { isDefault: true, type: 'DEFAULT' },
  });
}
