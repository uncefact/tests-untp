import type { ServiceType, AdapterRegistryEntry } from '@uncefact/untp-ri-services';
import { adapterRegistry } from '@uncefact/untp-ri-services/server';
import { createLogger } from '@uncefact/untp-ri-services/logging';
import { getEncryptionService } from '@/lib/encryption/encryption';
import { getInstanceByResolution } from '@/lib/prisma/repositories';
import {
  ServiceResolutionError,
  ServiceInstanceNotFoundError,
  ConfigDecryptionError,
  ConfigValidationError,
} from '@/lib/api/errors';

const logger = createLogger().child({ module: 'resolve-service' });

/**
 * Shape returned by resolveService — the resolved adapter
 * plus the service instance ID for provenance tracking.
 */
export interface ResolvedService<TService> {
  service: TService;
  instanceId: string;
}

/**
 * Generic service resolver that implements the resolution chain:
 * 1. Explicit instance ID (if provided)
 * 2. Tenant's primary service instance for the given service type
 * 3. System default service instance
 *
 * This replaces per-service-type resolvers with a single generic function.
 */
export async function resolveService<TService>(
  tenantId: string,
  serviceType: ServiceType,
  explicitInstanceId?: string,
): Promise<ResolvedService<TService>> {
  const instance = await getInstanceByResolution(tenantId, serviceType, explicitInstanceId);

  if (!instance) {
    if (explicitInstanceId) {
      throw new ServiceInstanceNotFoundError(explicitInstanceId);
    }
    throw new ServiceResolutionError(serviceType, tenantId);
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
    serviceType
  ];
  const adapterEntry = serviceEntry?.[instance.adapterType];
  if (!adapterEntry) {
    throw new ServiceResolutionError(serviceType, tenantId);
  }

  const parseResult = adapterEntry.configSchema.safeParse(rawConfig);
  if (!parseResult.success) {
    throw new ConfigValidationError(
      instance.id,
      parseResult.error.issues.map((i: { message: string }) => i.message).join(', '),
    );
  }

  return {
    service: adapterEntry.factory(parseResult.data, logger) as TService,
    instanceId: instance.id,
  };
}
