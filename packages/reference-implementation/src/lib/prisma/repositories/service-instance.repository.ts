import { ServiceInstance, ServiceType, AdapterType, Prisma } from '../generated';
import { prisma } from '../prisma';
import { SYSTEM_TENANT_ID } from '../constants';
import { NotFoundError } from '@/lib/api/errors';

export type CreateServiceInstanceInput = {
  tenantId: string;
  serviceType: string;
  adapterType: string;
  name: string;
  description?: string;
  config: string; // Already encrypted by the caller
  isPrimary?: boolean;
};

export type UpdateServiceInstanceInput = {
  name?: string;
  description?: string;
  config?: string; // Already encrypted by the caller
  isPrimary?: boolean;
};

export type ListServiceInstancesOptions = {
  serviceType?: string;
  adapterType?: string;
  limit?: number;
  offset?: number;
};

/**
 * Creates a new service instance. If isPrimary is true, first unsets
 * any existing primary for this org + serviceType combination.
 */
export async function createServiceInstance(input: CreateServiceInstanceInput): Promise<ServiceInstance> {
  return prisma.$transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.serviceInstance.updateMany({
        where: {
          tenantId: input.tenantId,
          serviceType: input.serviceType as ServiceType,
          isPrimary: true,
        },
        data: { isPrimary: false },
      });
    }

    return tx.serviceInstance.create({
      data: {
        tenantId: input.tenantId,
        serviceType: input.serviceType as ServiceType,
        adapterType: input.adapterType as AdapterType,
        name: input.name,
        description: input.description,
        config: input.config,
        isPrimary: input.isPrimary ?? false,
      },
    });
  });
}

/**
 * When a system default service instance has isPrimary true but the tenant
 * has set their own primary for the same serviceType, the system instance's
 * isPrimary should appear as false for that tenant.
 */
async function applyTenantPrimaryOverride(
  instance: ServiceInstance | null,
  tenantId: string,
): Promise<ServiceInstance | null> {
  if (!instance || instance.tenantId !== SYSTEM_TENANT_ID || !instance.isPrimary) return instance;

  const tenantPrimary = await prisma.serviceInstance.findFirst({
    where: {
      tenantId,
      serviceType: instance.serviceType,
      isPrimary: true,
    },
    select: { id: true },
  });

  return tenantPrimary ? { ...instance, isPrimary: false } : instance;
}

/**
 * Gets a service instance by ID. Returns it if owned by the specified
 * org or if it's a system default.
 * If the fetched instance is a system default, applies tenant primary override.
 */
export async function getServiceInstanceById(id: string, tenantId: string): Promise<ServiceInstance | null> {
  const instance = await prisma.serviceInstance.findFirst({
    where: {
      id,
      OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
    },
  });

  return applyTenantPrimaryOverride(instance, tenantId);
}

/**
 * Lists service instances for an organisation, including system defaults.
 */
export async function listServiceInstances(
  tenantId: string,
  options: ListServiceInstancesOptions = {},
): Promise<{ data: ServiceInstance[]; total: number }> {
  const { serviceType, adapterType, limit, offset } = options;

  const where: Prisma.ServiceInstanceWhereInput = {
    OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
  };

  if (serviceType !== undefined) {
    where.serviceType = serviceType as ServiceType;
  }

  if (adapterType !== undefined) {
    where.adapterType = adapterType as AdapterType;
  }

  const [data, total, tenantPrimaries] = await Promise.all([
    prisma.serviceInstance.findMany({
      where,
      take: limit ?? 20,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.serviceInstance.count({ where }),
    prisma.serviceInstance.findMany({
      where: { tenantId, isPrimary: true },
      select: { serviceType: true },
    }),
  ]);

  const tenantPrimaryTypes = new Set(tenantPrimaries.map((p) => p.serviceType));

  return {
    data: data.map((i) =>
      i.tenantId === SYSTEM_TENANT_ID && i.isPrimary && tenantPrimaryTypes.has(i.serviceType)
        ? { ...i, isPrimary: false }
        : i,
    ),
    total,
  };
}

/**
 * Updates a service instance. Cannot update system defaults.
 * If isPrimary is being set to true, unsets any existing primary first.
 */
export async function updateServiceInstance(
  id: string,
  tenantId: string,
  input: UpdateServiceInstanceInput,
): Promise<ServiceInstance> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.serviceInstance.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('Service instance not found or access denied');
    }

    if (input.isPrimary) {
      await tx.serviceInstance.updateMany({
        where: {
          tenantId,
          serviceType: existing.serviceType,
          isPrimary: true,
          NOT: { id },
        },
        data: { isPrimary: false },
      });
    }

    return tx.serviceInstance.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.config !== undefined && { config: input.config }),
        ...(input.isPrimary !== undefined && { isPrimary: input.isPrimary }),
      },
    });
  });
}

/**
 * Deletes a service instance. Cannot delete system defaults.
 */
export async function deleteServiceInstance(id: string, tenantId: string): Promise<ServiceInstance> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.serviceInstance.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('Service instance not found or access denied');
    }

    return tx.serviceInstance.delete({
      where: { id },
    });
  });
}

/**
 * Counts records that reference a given service instance.
 * Used for pre-delete referential integrity checks.
 */
export async function countServiceInstanceReferences(
  id: string,
): Promise<{ dids: number; registrars: number; schemes: number }> {
  const [dids, registrars, schemes] = await Promise.all([
    prisma.did.count({ where: { serviceInstanceId: id } }),
    prisma.registrar.count({ where: { idrServiceInstanceId: id } }),
    prisma.identifierScheme.count({ where: { idrServiceInstanceId: id } }),
  ]);

  return { dids, registrars, schemes };
}

/**
 * Implements the instance resolution chain:
 * 1. Explicit instance ID - verify ownership or system default
 * 2. Tenant primary (isPrimary for org + serviceType)
 * 3. System default (tenantId === SYSTEM_TENANT_ID)
 * 4. Returns null if nothing found
 */
export async function getInstanceByResolution(
  tenantId: string,
  serviceType: string,
  instanceId?: string,
): Promise<ServiceInstance | null> {
  // Step 1: Explicit instance ID
  if (instanceId) {
    return prisma.serviceInstance.findFirst({
      where: {
        id: instanceId,
        OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
      },
    });
  }

  // Step 2: Tenant primary
  const tenantPrimary = await prisma.serviceInstance.findFirst({
    where: {
      tenantId,
      serviceType: serviceType as ServiceType,
      isPrimary: true,
    },
  });

  if (tenantPrimary) {
    return tenantPrimary;
  }

  // Step 3: System default
  return prisma.serviceInstance.findFirst({
    where: {
      tenantId: SYSTEM_TENANT_ID,
      serviceType: serviceType as ServiceType,
    },
  });
}
