import type { PrismaClient } from '@/lib/prisma/generated';
import { createLogger } from '@uncefact/untp-ri-services/logging';

const SYSTEM_TENANT_ID = 'system';
const logger = createLogger().child({ module: 'clone-system-defaults' });

type PrismaTransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

type TransactionalPrisma = PrismaClient | PrismaTransactionClient;

/**
 * Clones the system tenant's default service instances and DID into
 * a newly created tenant. The encrypted config blobs are copied as-is
 * because the encryption key is global.
 *
 * Runs inside a Prisma interactive transaction to ensure atomicity.
 */
export async function cloneSystemDefaults(prisma: PrismaClient, tenantId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    return cloneWithinTransaction(tx, tenantId);
  });
}

async function cloneWithinTransaction(tx: TransactionalPrisma, tenantId: string): Promise<string> {
  logger.debug({ tenantId }, 'Cloning system defaults for tenant');
  const systemInstances = await tx.serviceInstance.findMany({
    where: { tenantId: SYSTEM_TENANT_ID },
  });

  const systemDefaultDid = await tx.did.findFirst({
    where: { tenantId: SYSTEM_TENANT_ID, isDefault: true },
  });

  if (systemInstances.length === 0 && !systemDefaultDid) {
    logger.debug({ tenantId }, 'No system defaults to clone');
    return tenantId;
  }

  logger.info(
    { tenantId, instanceCount: systemInstances.length, hasDid: !!systemDefaultDid },
    'Starting clone process',
  );

  // Clone each service instance, keeping a mapping from old ID to new ID
  // so we can re-link the DID correctly.
  const instanceIdMap = new Map<string, string>();

  for (const instance of systemInstances) {
    const cloned = await tx.serviceInstance.create({
      data: {
        tenantId: tenantId,
        serviceType: instance.serviceType,
        adapterType: instance.adapterType,
        name: instance.name,
        description: instance.description,
        config: instance.config,
        apiVersion: instance.apiVersion,
        isPrimary: instance.isPrimary,
      },
    });

    instanceIdMap.set(instance.id, cloned.id);
  }

  if (systemDefaultDid) {
    const clonedDid = `${systemDefaultDid.did}:org:${tenantId}`;

    const existing = await tx.did.findFirst({
      where: { did: clonedDid, tenantId: tenantId },
    });

    if (!existing) {
      const clonedServiceInstanceId = systemDefaultDid.serviceInstanceId
        ? instanceIdMap.get(systemDefaultDid.serviceInstanceId) ?? null
        : null;

      await tx.did.create({
        data: {
          tenantId: tenantId,
          did: clonedDid,
          type: systemDefaultDid.type,
          method: systemDefaultDid.method,
          name: systemDefaultDid.name,
          description: systemDefaultDid.description,
          keyId: systemDefaultDid.keyId,
          status: systemDefaultDid.status,
          isDefault: false,
          serviceInstanceId: clonedServiceInstanceId,
        },
      });
      logger.info({ tenantId, did: clonedDid }, 'Cloned default DID');
    } else {
      logger.debug({ tenantId, did: clonedDid }, 'DID already exists, skipping clone');
    }
  }

  logger.info({ tenantId }, 'System defaults cloned successfully');
  return tenantId;
}
