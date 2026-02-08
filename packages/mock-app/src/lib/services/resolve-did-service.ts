import { ServiceType, AdapterType } from "@mock-app/services";
import { adapterRegistry } from "@mock-app/services/server";
import type { IDidService } from "@mock-app/services";
import { getEncryptionService } from "@/lib/encryption/encryption";
import { getInstanceByResolution } from "@/lib/prisma/repositories";
import {
  ServiceResolutionError,
  ServiceInstanceNotFoundError,
  ConfigDecryptionError,
  ConfigValidationError,
} from "@/lib/api/errors";

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
  const instance = await getInstanceByResolution(
    organizationId,
    ServiceType.DID,
    serviceInstanceId,
  );

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
  } catch {
    throw new ConfigDecryptionError(instance.id);
  }

  // Parse and validate
  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(decryptedJson);
  } catch {
    throw new ConfigValidationError(
      instance.id,
      "Invalid JSON in decrypted config",
    );
  }

  const adapterEntry =
    adapterRegistry[ServiceType.DID]?.[instance.adapterType as AdapterType];
  if (!adapterEntry) {
    throw new ServiceResolutionError(ServiceType.DID, organizationId);
  }

  const parseResult = adapterEntry.configSchema.safeParse(rawConfig);
  if (!parseResult.success) {
    throw new ConfigValidationError(
      instance.id,
      parseResult.error.issues.map((i) => i.message).join(", "),
    );
  }

  return {
    service: adapterEntry.factory(parseResult.data) as IDidService,
    instanceId: instance.id,
  };
}
