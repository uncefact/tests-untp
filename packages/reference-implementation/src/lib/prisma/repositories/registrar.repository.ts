import { Registrar, Prisma } from '../generated';
import { prisma } from '../prisma';
import { SYSTEM_TENANT_ID } from '../constants';
import { ConflictError, NotFoundError, ServiceInstanceNotFoundError } from '@/lib/api/errors';
import { isForeignKeyViolation, isForeignKeyViolationOn, mapDatabaseError } from '@/lib/prisma/db-errors';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';

/**
 * Input for creating a new registrar
 */
export type CreateRegistrarInput = {
  tenantId: string;
  name: string;
  namespace: string;
  url?: string;
  idrServiceInstanceId?: string;
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
  try {
    return await prisma.registrar.create({
      data: {
        tenantId: input.tenantId,
        name: input.name,
        namespace: input.namespace,
        url: input.url,
        idrServiceInstanceId: input.idrServiceInstanceId,
      },
    });
  } catch (e) {
    // The insert carries two foreign keys (tenantId and idrServiceInstanceId),
    // so the violated column must be matched before attributing a message; a
    // bare P2003 mapping here would blame the IDR instance reference for a
    // tenantId violation too. The route handler pre-checks the instance with a
    // tenant-scoped lookup and a 404, so an instance deleted between that
    // check and the insert surfaces as the same 404. Anything else (including
    // a tenant deleted mid-request) rethrows into the sanitised 500 branch
    // rather than carrying a misattributed message.
    if (isForeignKeyViolationOn(e, 'idrServiceInstanceId')) {
      throw new ServiceInstanceNotFoundError(String(input.idrServiceInstanceId));
    }
    throw e;
  }
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
export async function listRegistrars(
  tenantId: string,
  options: ListRegistrarsOptions = {},
): Promise<{ data: Registrar[]; total: number }> {
  const { limit, offset } = options;

  const where: Prisma.RegistrarWhereInput = {
    OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
  };

  const [data, total] = await Promise.all([
    prisma.registrar.findMany({
      where,
      take: limit ?? DEFAULT_PAGE_LIMIT,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.registrar.count({ where }),
  ]);

  return { data, total };
}

/**
 * Updates a registrar. Cannot update system defaults.
 * Validates that the registrar belongs to the specified organisation.
 */
export async function updateRegistrar(id: string, tenantId: string, input: UpdateRegistrarInput): Promise<Registrar> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.registrar.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('Registrar not found');
    }

    try {
      return await tx.registrar.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.namespace !== undefined && { namespace: input.namespace }),
          ...(input.url !== undefined && { url: input.url }),
          ...(input.idrServiceInstanceId !== undefined && { idrServiceInstanceId: input.idrServiceInstanceId }),
        },
      });
    } catch (e) {
      // Same two-foreign-key insert shape as createRegistrar: only a P2003
      // whose violated column is idrServiceInstanceId surfaces as the route
      // pre-check's 404 (the backstop for an instance deleted between that
      // check and this write); any other violation rethrows via
      // mapDatabaseError's fall-through.
      if (isForeignKeyViolationOn(e, 'idrServiceInstanceId')) {
        throw new ServiceInstanceNotFoundError(String(input.idrServiceInstanceId));
      }
      mapDatabaseError(e, {
        notFound: 'Registrar not found',
      });
    }
  });
}

/**
 * Deletes a registrar. Cannot delete system defaults.
 * Validates that the registrar belongs to the specified organisation.
 */
export async function deleteRegistrar(id: string, tenantId: string): Promise<Registrar> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.registrar.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('Registrar not found');
    }

    try {
      return await tx.registrar.delete({
        where: { id },
      });
    } catch (e) {
      // Deleting a registrar cascades into its schemes, and Identifier.scheme
      // is declared with onDelete: Restrict, so a foreign-key violation here
      // means identifiers block the cascade (a conflict), not that a
      // referenced record is missing.
      if (isForeignKeyViolation(e)) {
        throw new ConflictError('The registrar has schemes with identifiers and cannot be deleted');
      }
      mapDatabaseError(e, { notFound: 'Registrar not found' });
    }
  });
}
