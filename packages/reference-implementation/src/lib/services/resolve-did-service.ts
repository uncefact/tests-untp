import { ServiceType, AdapterType } from '@uncefact/untp-ri-services';
import { adapterRegistry } from '@uncefact/untp-ri-services/server';
import type { IDidService } from '@uncefact/untp-ri-services';
import { getEncryptionService } from '@/lib/encryption/encryption';
import { getInstanceByResolution } from '@/lib/prisma/repositories';
import {
  ServiceResolutionError,
  ServiceInstanceNotFoundError,
  ConfigDecryptionError,
  ConfigValidationError,
} from '@/lib/api/errors';

/**
 * Shape returned by resolveDidService — the resolved adapter
 * plus the service instance ID for provenance tracking.
 */
export interface ResolvedDidService {
  service: IDidService;
  instanceId: string;
}

/**
 * Resolves a DID service adapter for the given organisation.
 *
 * Resolution chain:
 * 1. Explicit instance ID (if provided)
 * 2. Tenant primary (isPrimary === true for org + DID service type)
 * 3. System default (organizationId === "system")
 * 4. Throw ServiceResolutionError
 */
export async function resolveDidService(
  organizationId: string,
  serviceInstanceId?: string,
): Promise<ResolvedDidService> {
  const instance = await getInstanceByResolution(organizationId, ServiceType.DID, serviceInstanceId);

  if (!instance) {
    if (serviceInstanceId) {
      throw new ServiceInstanceNotFoundError(serviceInstanceId);
    }
    throw new ServiceResolutionError(ServiceType.DID, organizationId);
  }

  // Decrypt the config
  let decryptedJson: string;
  try {
    decryptedJson = getEncryptionService().decrypt(JSON.parse(instance.config));
  } catch (error) {
    console.error('[resolve-did-service] Config decryption failed:', {
      instanceId: instance.id,
      error: error instanceof Error ? error.message : error,
    });
    throw new ConfigDecryptionError(instance.id);
  }

  // Parse and validate
  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(decryptedJson);
  } catch (error) {
    console.error('[resolve-did-service] Config JSON parse failed:', {
      instanceId: instance.id,
      error: error instanceof Error ? error.message : error,
    });
    throw new ConfigValidationError(instance.id, 'Invalid JSON in decrypted config');
  }

  const adapterEntry = adapterRegistry[ServiceType.DID]?.[instance.adapterType as AdapterType];
  if (!adapterEntry) {
    throw new ServiceResolutionError(ServiceType.DID, organizationId);
  }

  const parseResult = adapterEntry.configSchema.safeParse(rawConfig);
  if (!parseResult.success) {
    throw new ConfigValidationError(instance.id, parseResult.error.issues.map((i) => i.message).join(', '));
  }

  return {
    service: adapterEntry.factory(parseResult.data) as IDidService,
    instanceId: instance.id,
  };
}
