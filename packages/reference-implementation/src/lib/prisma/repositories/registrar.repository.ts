import { Registrar, Prisma } from '../generated';
import { prisma } from '../prisma';
import { NotFoundError } from '@/lib/api/errors';

const SYSTEM_TENANT_ID = 'system';

/**
 * Input for creating a new registrar
 */
export type CreateRegistrarInput = {
  tenantId: string;
  name: string;
  namespace: string;
  url?: string;
  idrServiceInstanceId?: string;
  isDefault?: boolean;
};

/**
 * Input for updating a registrar
 */
export type UpdateRegistrarInput = {
  name?: string;
  namespace?: string;
  url?: string;
  idrServiceInstanceId?: string | null;
};

/**
 * Options for listing registrars
 */
export type ListRegistrarsOptions = {
  limit?: number;
  offset?: number;
};

/**
 * Creates a new registrar scoped to an organisation (tenant).
 */
export async function createRegistrar(input: CreateRegistrarInput): Promise<Registrar> {
  return prisma.registrar.create({
    data: {
      tenantId: input.tenantId,
      name: input.name,
      namespace: input.namespace,
      url: input.url,
      idrServiceInstanceId: input.idrServiceInstanceId,
      isDefault: input.isDefault ?? false,
    },
  });
}

/**
 * Retrieves a registrar by ID, scoped to an organisation.
 * Returns the registrar if owned by the specified tenant or if it's a system default.
 * Includes nested schemes and their qualifiers.
 */
export async function getRegistrarById(id: string, tenantId: string): Promise<Registrar | null> {
  return prisma.registrar.findFirst({
    where: {
      id,
      OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
    },
    include: {
      schemes: {
        include: {
          qualifiers: true,
        },
      },
    },
  });
}

/**
 * Lists registrars for an organisation, including system defaults.
 */
export async function listRegistrars(tenantId: string, options: ListRegistrarsOptions = {}): Promise<Registrar[]> {
  const { limit, offset } = options;

  const where: Prisma.RegistrarWhereInput = {
    OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
  };

  return prisma.registrar.findMany({
    where,
    include: {
      schemes: {
        include: {
          qualifiers: true,
        },
      },
    },
    take: limit ?? 100,
    skip: offset,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Updates a registrar. Cannot update system defaults.
 * Validates that the registrar belongs to the specified organisation.
 */
export async function updateRegistrar(id: string, tenantId: string, input: UpdateRegistrarInput): Promise<Registrar> {
  const existing = await prisma.registrar.findFirst({
    where: { id, tenantId },
  });

  if (!existing) {
    throw new NotFoundError('Registrar not found or access denied');
  }

  return prisma.registrar.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.namespace !== undefined && { namespace: input.namespace }),
      ...(input.url !== undefined && { url: input.url }),
      ...(input.idrServiceInstanceId !== undefined && { idrServiceInstanceId: input.idrServiceInstanceId }),
    },
  });
}

/**
 * Deletes a registrar. Cannot delete system defaults.
 * Validates that the registrar belongs to the specified organisation.
 */
export async function deleteRegistrar(id: string, tenantId: string): Promise<Registrar> {
  const existing = await prisma.registrar.findFirst({
    where: { id, tenantId },
  });

  if (!existing) {
    throw new NotFoundError('Registrar not found or access denied');
  }

  return prisma.registrar.delete({
    where: { id },
  });
}
