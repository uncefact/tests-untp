import type { PrismaClient } from '@/lib/prisma/generated';

const SYSTEM_ORG_ID = 'system';

type PrismaTransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

type TransactionalPrisma = PrismaClient | PrismaTransactionClient;

/**
 * Clones the system organisation's default service instances and DID into
 * a newly created organisation. The encrypted config blobs are copied as-is
 * because the encryption key is global.
 *
 * Runs inside a Prisma interactive transaction to ensure atomicity.
 */
export async function cloneSystemDefaults(prisma: PrismaClient, organisationId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    return cloneWithinTransaction(tx, organisationId);
  });
}

async function cloneWithinTransaction(tx: TransactionalPrisma, organisationId: string): Promise<string> {
  // Fetch all system service instances
  const systemInstances = await tx.serviceInstance.findMany({
    where: { organizationId: SYSTEM_ORG_ID },
  });

  // Fetch the system default DID
  const systemDefaultDid = await tx.did.findFirst({
    where: { organizationId: SYSTEM_ORG_ID, isDefault: true },
  });

  // Nothing to clone — early return
  if (systemInstances.length === 0 && !systemDefaultDid) {
    return organisationId;
  }

  // Clone each service instance, keeping a mapping from old ID to new ID
  // so we can re-link the DID correctly.
  const instanceIdMap = new Map<string, string>();

  for (const instance of systemInstances) {
    const cloned = await tx.serviceInstance.create({
      data: {
        organizationId: organisationId,
        serviceType: instance.serviceType,
        adapterType: instance.adapterType,
        name: instance.name,
        description: instance.description,
        config: instance.config,
        isPrimary: instance.isPrimary,
      },
    });

    instanceIdMap.set(instance.id, cloned.id);
  }

  // Clone the default DID, linking it to the cloned service instance
  if (systemDefaultDid) {
    const clonedDid = `${systemDefaultDid.did}:org:${organisationId}`;

    // Skip if already cloned (idempotent on retry)
    const existing = await tx.did.findFirst({
      where: { did: clonedDid, organizationId: organisationId },
    });

    if (!existing) {
      const clonedServiceInstanceId = systemDefaultDid.serviceInstanceId
        ? instanceIdMap.get(systemDefaultDid.serviceInstanceId) ?? null
        : null;

      await tx.did.create({
        data: {
          organizationId: organisationId,
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
    }
  }

  return organisationId;
}
