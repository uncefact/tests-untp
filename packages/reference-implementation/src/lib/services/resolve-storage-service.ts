import { ServiceType } from '@uncefact/untp-ri-services';
import type { AdapterRegistryEntry } from '@uncefact/untp-ri-services';
import { adapterRegistry } from '@uncefact/untp-ri-services/server';
import type { IStorageService as IStorageServiceV2 } from '@uncefact/untp-ri-services';
import { createLogger } from '@uncefact/untp-ri-services/logging';
import { getEncryptionService } from '@/lib/encryption/encryption';
import { getInstanceByResolution } from '@/lib/prisma/repositories';
import {
  ServiceResolutionError,
  ServiceInstanceNotFoundError,
  ConfigDecryptionError,
  ConfigValidationError,
} from '@/lib/api/errors';

const logger = createLogger().child({ module: 'resolve-storage-service' });

/**
 * Shape returned by resolveStorageService — the resolved adapter
 * plus the service instance ID for provenance tracking.
 */
export interface ResolvedStorageService {
  service: IStorageServiceV2;
  instanceId: string;
}

/**
 * Resolves a storage service adapter using the resolution chain:
 * 1. Explicit instance ID (if provided)
 * 2. Tenant's primary storage service instance
 * 3. System default storage service instance
 */
export async function resolveStorageService(
  tenantId: string,
  explicitInstanceId?: string,
): Promise<ResolvedStorageService> {
  const instance = await getInstanceByResolution(tenantId, ServiceType.STORAGE, explicitInstanceId);

  if (!instance) {
    if (explicitInstanceId) {
      throw new ServiceInstanceNotFoundError(explicitInstanceId);
    }
    throw new ServiceResolutionError(ServiceType.STORAGE, tenantId);
  }

  // Decrypt the config
  let decryptedJson: string;
  try {
    decryptedJson = getEncryptionService().decrypt(JSON.parse(instance.config));
  } catch (error) {
    logger.error({ error, instanceId: instance.id }, 'Config decryption failed');
    throw new ConfigDecryptionError(instance.id);
  }

  // Parse and validate
  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(decryptedJson);
  } catch (error) {
    logger.error({ error, instanceId: instance.id }, 'Config JSON parse failed');
    throw new ConfigValidationError(instance.id, 'Invalid JSON in decrypted config');
  }

  const serviceEntry = (adapterRegistry as Record<string, Record<string, AdapterRegistryEntry> | undefined>)[
    ServiceType.STORAGE
  ];
  const adapterEntry = serviceEntry?.[instance.adapterType];
  if (!adapterEntry) {
    throw new ServiceResolutionError(ServiceType.STORAGE, tenantId);
  }

  const parseResult = adapterEntry.configSchema.safeParse(rawConfig);
  if (!parseResult.success) {
    throw new ConfigValidationError(
      instance.id,
      parseResult.error.issues.map((i: { message: string }) => i.message).join(', '),
    );
  }

  return {
    service: adapterEntry.factory(parseResult.data, logger) as IStorageServiceV2,
    instanceId: instance.id,
  };
}
