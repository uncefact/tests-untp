import { ServiceType } from '@uncefact/untp-ri-services';
import type { AdapterRegistryEntry } from '@uncefact/untp-ri-services';
import { adapterRegistry } from '@uncefact/untp-ri-services/server';
import type { IIdentityResolverService, Logger } from '@uncefact/untp-ri-services';
import { getEncryptionService } from '@/lib/encryption/encryption';
import { getInstanceByResolution } from '@/lib/prisma/repositories';
import {
  ServiceResolutionError,
  ServiceInstanceNotFoundError,
  ConfigDecryptionError,
  ConfigValidationError,
} from '@/lib/api/errors';

/**
 * Shape returned by resolveIdrService — the resolved adapter
 * plus the service instance ID for provenance tracking.
 */
export interface ResolvedIdrService {
  service: IIdentityResolverService;
  instanceId: string;
}

/**
 * Resolves an IDR service adapter using the 4-step resolution chain:
 * 1. Scheme's idrServiceInstanceId
 * 2. Registrar's idrServiceInstanceId
 * 3. Tenant's primary IDR service instance
 * 4. System default IDR service instance
 */
export async function resolveIdrService(
  tenantId: string,
  schemeIdrServiceInstanceId?: string | null,
  registrarIdrServiceInstanceId?: string | null,
): Promise<ResolvedIdrService> {
  // Pick the most specific explicit ID: scheme takes priority over registrar
  const explicitId = schemeIdrServiceInstanceId ?? registrarIdrServiceInstanceId ?? undefined;

  const instance = await getInstanceByResolution(tenantId, ServiceType.IDR, explicitId);

  if (!instance) {
    if (explicitId) {
      throw new ServiceInstanceNotFoundError(explicitId);
    }
    throw new ServiceResolutionError(ServiceType.IDR, tenantId);
  }

  // Decrypt the config
  let decryptedJson: string;
  try {
    decryptedJson = getEncryptionService().decrypt(JSON.parse(instance.config));
  } catch (error) {
    console.error('[resolve-idr-service] Config decryption failed:', {
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
    console.error('[resolve-idr-service] Config JSON parse failed:', {
      instanceId: instance.id,
      error: error instanceof Error ? error.message : error,
    });
    throw new ConfigValidationError(instance.id, 'Invalid JSON in decrypted config');
  }

  const serviceEntry = (adapterRegistry as Record<string, Record<string, AdapterRegistryEntry> | undefined>)[
    ServiceType.IDR
  ];
  const adapterEntry = serviceEntry?.[instance.adapterType];
  if (!adapterEntry) {
    throw new ServiceResolutionError(ServiceType.IDR, tenantId);
  }

  const parseResult = adapterEntry.configSchema.safeParse(rawConfig);
  if (!parseResult.success) {
    throw new ConfigValidationError(
      instance.id,
      parseResult.error.issues.map((i: { message: string }) => i.message).join(', '),
    );
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
    }) as IIdentityResolverService,
    instanceId: instance.id,
  };
}
