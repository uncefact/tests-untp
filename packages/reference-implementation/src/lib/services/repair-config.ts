import type { PrismaClient } from '@/lib/prisma/generated';
import type { AdapterRegistryEntry } from '@uncefact/untp-ri-services';
import { EncryptionAlgorithm } from '@uncefact/untp-ri-services';
import { adapterRegistry } from '@uncefact/untp-ri-services/server';
import { prisma } from '@/lib/prisma/prisma';
import { getEncryptionService } from '@/lib/encryption/encryption';
import { lockServiceInstanceForUpdate } from '@/lib/prisma/repositories/service-instance-lock.repository';
import {
  recordAcceptedReplacementDigest,
  countPendingEntriesForInstance,
} from '@/lib/prisma/repositories/credential-status-entry.repository';
import { statusConfigDigest } from '@/lib/credentials/credential-status-context';

export type RepairServiceConfigInput = { instanceId: string; config: unknown; allowPending: boolean };

/**
 * Replaces a VC instance configuration after live reservations have expired.
 * The instance lock protects the pin updates without taking any parent lock.
 * Original pins and tokens survive until explicit reconciliation records a fact.
 */
export async function repairServiceConfig(input: RepairServiceConfigInput, client: PrismaClient = prisma) {
  return client.$transaction(async (tx) => {
    const instance = await tx.serviceInstance.findUnique({ where: { id: input.instanceId } });
    if (!instance || !(await lockServiceInstanceForUpdate(tx, instance.id, instance.tenantId))) {
      throw new Error('The service instance does not exist. No configuration was changed.');
    }
    const locked = await tx.serviceInstance.findUniqueOrThrow({ where: { id: instance.id } });
    if (locked.serviceType !== 'VC') throw new Error('Configuration repair supports VC instances only.');
    const entry = (adapterRegistry.VC as Record<string, AdapterRegistryEntry>)[locked.adapterType];
    if (!entry) throw new Error('The configured VC adapter is not registered.');
    const parsed = entry.configSchema.safeParse(input.config);
    if (!parsed.success)
      throw new Error('The replacement configuration does not match the VC adapter schema.', { cause: parsed.error });
    const pending = await countPendingEntriesForInstance(tx, locked.id, locked.tenantId);
    if (pending > 0 && !input.allowPending)
      throw new Error(
        `${pending} pending status intent(s) exist. Supply --allow-pending only after stopping admission and draining provider requests.`,
      );
    const digest = await statusConfigDigest(parsed.data);
    const accepted = await recordAcceptedReplacementDigest(tx, {
      instanceId: locked.id,
      tenantId: locked.tenantId,
      digest,
    });
    if (accepted.outcome === 'live_reservation')
      throw new Error(
        `${accepted.live} reservation(s) have not passed their deadline. No configuration or pending intent was changed.`,
      );
    const config = JSON.stringify(
      getEncryptionService().encrypt(JSON.stringify(parsed.data), EncryptionAlgorithm.AES_256_GCM),
    );
    await tx.serviceInstance.update({ where: { id: locked.id }, data: { config } });
    return { instanceId: locked.id, pendingEntries: accepted.updated, replacementDigest: digest };
  });
}
