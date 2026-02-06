import { ServiceInstance, ServiceType, AdapterType, Prisma } from '../generated';
import { prisma } from '../prisma';

const SYSTEM_ORG_ID = 'system';

export type CreateServiceInstanceInput = {
  organizationId: string;
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
          organizationId: input.organizationId,
          serviceType: input.serviceType as ServiceType,
          isPrimary: true,
        },
        data: { isPrimary: false },
      });
    }

    return tx.serviceInstance.create({
      data: {
        organizationId: input.organizationId,
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
 * Gets a service instance by ID. Returns it if owned by the specified
 * org or if it's a system default.
 */
export async function getServiceInstanceById(id: string, organizationId: string): Promise<ServiceInstance | null> {
  return prisma.serviceInstance.findFirst({
    where: {
      id,
      OR: [{ organizationId }, { organizationId: SYSTEM_ORG_ID }],
    },
  });
}

/**
 * Lists service instances for an organisation, including system defaults.
 */
export async function listServiceInstances(
  organizationId: string,
  options: ListServiceInstancesOptions = {},
): Promise<ServiceInstance[]> {
  const { serviceType, adapterType, limit, offset } = options;

  const where: Prisma.ServiceInstanceWhereInput = {
    OR: [{ organizationId }, { organizationId: SYSTEM_ORG_ID }],
  };

  if (serviceType !== undefined) {
    where.serviceType = serviceType as ServiceType;
  }

  if (adapterType !== undefined) {
    where.adapterType = adapterType as AdapterType;
  }

  return prisma.serviceInstance.findMany({
    where,
    take: limit ?? 100,
    skip: offset,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Updates a service instance. Cannot update system defaults.
 * If isPrimary is being set to true, unsets any existing primary first.
 */
export async function updateServiceInstance(
  id: string,
  organizationId: string,
  input: UpdateServiceInstanceInput,
): Promise<ServiceInstance> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.serviceInstance.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new Error('Service instance not found or access denied');
    }

    if (input.isPrimary) {
      await tx.serviceInstance.updateMany({
        where: {
          organizationId,
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
export async function deleteServiceInstance(id: string, organizationId: string): Promise<ServiceInstance> {
  const existing = await prisma.serviceInstance.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    throw new Error('Service instance not found or access denied');
  }

  return prisma.serviceInstance.delete({
    where: { id },
  });
}

/**
 * Implements the instance resolution chain:
 * 1. Explicit instance ID - verify ownership or system default
 * 2. Tenant primary (isPrimary for org + serviceType)
 * 3. System default (organizationId === "system")
 * 4. Returns null if nothing found
 */
export async function getInstanceByResolution(
  organizationId: string,
  serviceType: string,
  instanceId?: string,
): Promise<ServiceInstance | null> {
  // Step 1: Explicit instance ID
  if (instanceId) {
    return prisma.serviceInstance.findFirst({
      where: {
        id: instanceId,
        OR: [{ organizationId }, { organizationId: SYSTEM_ORG_ID }],
      },
    });
  }

  // Step 2: Tenant primary
  const tenantPrimary = await prisma.serviceInstance.findFirst({
    where: {
      organizationId,
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
      organizationId: SYSTEM_ORG_ID,
      serviceType: serviceType as ServiceType,
    },
  });
}
