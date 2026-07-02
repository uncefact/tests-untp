import { Did, DidStatus, Prisma } from '../generated';
import { prisma } from '../prisma';
import { NotFoundError } from '@/lib/api/errors';
import { mapDatabaseError } from '@/lib/prisma/db-errors';
import { ValidationError } from '@/lib/api/validation';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';

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

  try {
    if (input.isDefault) {
      return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

    return await prisma.did.create({ data });
  } catch (e) {
    mapDatabaseError(e, {
      conflict: 'A DID record with this DID already exists',
      invalidReference: 'Service instance not found',
    });
  }
}

/**
 * When a system DEFAULT DID has isDefault true but the tenant has set their own
 * default, the system DID's isDefault should appear as false for that tenant.
 */
async function applyTenantDefaultOverride(did: Did | null, tenantId: string): Promise<Did | null> {
  if (!did || did.type !== 'DEFAULT' || !did.isDefault) return did;

  const tenantDefault = await prisma.did.findFirst({
    where: { tenantId, isDefault: true, type: { not: 'DEFAULT' } },
  });

  return tenantDefault ? { ...did, isDefault: false } : did;
}

/**
 * Retrieves a DID by ID, scoped to an organisation.
 * Returns null if the DID does not exist or belongs to a different organisation.
 * If the fetched DID is a system DEFAULT, applies tenant default override.
 */
export async function getDidById(id: string, tenantId: string): Promise<Did | null> {
  const did = await prisma.did.findFirst({
    where: {
      id,
      OR: [{ tenantId }, { type: 'DEFAULT' }],
    },
  });

  return applyTenantDefaultOverride(did, tenantId);
}

/**
 * Retrieves a DID by its DID string (e.g. "did:web:example.com"), scoped to an organisation.
 * Also returns system default DIDs regardless of tenant. Returns null if the DID
 * does not exist or belongs to a different non-default organisation.
 * If the fetched DID is a system DEFAULT, applies tenant default override.
 */
export async function getDidByDid(didString: string, tenantId: string): Promise<Did | null> {
  const did = await prisma.did.findFirst({
    where: {
      did: didString,
      OR: [{ tenantId }, { type: 'DEFAULT' }],
    },
  });

  return applyTenantDefaultOverride(did, tenantId);
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
    OR: [{ tenantId }, { type: 'DEFAULT' }],
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
      take: limit ?? DEFAULT_PAGE_LIMIT,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.did.count({ where }),
  ]);

  const tenantHasDefault = data.some((d: Did) => d.isDefault && d.type !== 'DEFAULT');
  if (tenantHasDefault) {
    return {
      data: data.map((d: Did) => (d.type === 'DEFAULT' && d.isDefault ? { ...d, isDefault: false } : d)),
      total,
    };
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
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

    try {
      return await tx.did.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
        },
      });
    } catch (e) {
      mapDatabaseError(e, { notFound: 'DID not found or access denied' });
    }
  });
}

/**
 * Updates a DID's status (used for verification flow).
 * Validates that the DID belongs to the specified organisation.
 */
export async function updateDidStatus(id: string, tenantId: string, status: DidStatus): Promise<Did> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.did.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('DID not found or access denied');
    }

    try {
      return await tx.did.update({
        where: { id },
        data: { status },
      });
    } catch (e) {
      mapDatabaseError(e, { notFound: 'DID not found or access denied' });
    }
  });
}

/**
 * Deletes a DID.
 * Validates that the DID exists and belongs to the specified organisation.
 */
export async function deleteDid(id: string, tenantId: string): Promise<void> {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.did.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('DID not found or access denied');
    }

    try {
      await tx.did.delete({
        where: { id },
      });
    } catch (e) {
      mapDatabaseError(e, { notFound: 'DID not found or access denied' });
    }
  });
}

/**
 * Returns the default DID. When a tenantId is provided, prefers the tenant's
 * own default DID over the system default. Falls back to the system default
 * if the tenant has no default set.
 */
/**
 * Checks whether a DID with the given alias already exists on the specified service instance.
 * Uses endsWith matching since the normalised alias forms the trailing segment(s) of the DID URI.
 */
export async function findDidByAliasAndService(normalisedAlias: string, serviceInstanceId: string): Promise<boolean> {
  const existing = await prisma.did.findFirst({
    where: {
      serviceInstanceId,
      did: { endsWith: `:${normalisedAlias}` },
    },
    select: { id: true },
  });
  return existing !== null;
}

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
