import { ServiceType, AdapterType, createLogger } from '@uncefact/untp-ri-services';
import { adapterRegistry } from '@uncefact/untp-ri-services/server';
import type { IDidService, Logger } from '@uncefact/untp-ri-services';
import { getEncryptionService } from '@/lib/encryption/encryption';
import { getInstanceByResolution } from '@/lib/prisma/repositories';
import {
  ServiceResolutionError,
  ServiceInstanceNotFoundError,
  ConfigDecryptionError,
  ConfigValidationError,
} from '@/lib/api/errors';

const logger = createLogger().child({ module: 'resolve-did-service' });

/**
 * Shape returned by resolveDidService — the resolved adapter
 * plus the service instance ID for provenance tracking.
 */
export interface ResolvedDidService {
  service: IDidService;
  instanceId: string;
}

/**
 * Resolves a DID service adapter for the given tenant.
 *
 * Resolution chain:
 * 1. Explicit instance ID (if provided)
 * 2. Tenant primary (isPrimary === true for tenant + DID service type)
 * 3. System default (tenantId === "system")
 * 4. Throw ServiceResolutionError
 */
export async function resolveDidService(tenantId: string, serviceInstanceId?: string): Promise<ResolvedDidService> {
  const instance = await getInstanceByResolution(tenantId, ServiceType.DID, serviceInstanceId);

  if (!instance) {
    if (serviceInstanceId) {
      throw new ServiceInstanceNotFoundError(serviceInstanceId);
    }
    throw new ServiceResolutionError(ServiceType.DID, tenantId);
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

  const adapterEntry = adapterRegistry[ServiceType.DID]?.[instance.adapterType as AdapterType];
  if (!adapterEntry) {
    throw new ServiceResolutionError(ServiceType.DID, tenantId);
  }

  const parseResult = adapterEntry.configSchema.safeParse(rawConfig);
  if (!parseResult.success) {
    throw new ConfigValidationError(instance.id, parseResult.error.issues.map((i) => i.message).join(', '));
  }

  const consoleLogger: Logger = {
    info: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  return {
    service: adapterEntry.factory(parseResult.data, {
      name: instance.adapterType,
      version: instance.apiVersion,
      logger: consoleLogger,
    }) as IDidService,
    instanceId: instance.id,
  };
}
