/**
 * Extract a human-readable message from an unknown caught value.
 */
export function errorMessage(e: unknown, fallback = 'An unexpected error has occurred.'): string {
  return e instanceof Error ? e.message : fallback;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ServiceRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceRegistryError';
  }
}

export class ServiceInstanceNotFoundError extends ServiceRegistryError {
  constructor(instanceId: string) {
    super(`Service instance not found: ${instanceId}`);
    this.name = 'ServiceInstanceNotFoundError';
  }
}

export class ServiceResolutionError extends ServiceRegistryError {
  constructor(serviceType: string, tenantId: string) {
    super(
      `No service instance available for type "${serviceType}" ` +
        `in tenant "${tenantId}". ` +
        `Configure a primary instance or ensure a system default exists.`,
    );
    this.name = 'ServiceResolutionError';
  }
}

export class ConfigDecryptionError extends ServiceRegistryError {
  constructor(instanceId: string) {
    super(
      `Failed to decrypt configuration for service instance "${instanceId}". ` +
        `Check that SERVICE_ENCRYPTION_KEY matches the key used during encryption.`,
    );
    this.name = 'ConfigDecryptionError';
  }
}

export class ConfigValidationError extends ServiceRegistryError {
  constructor(instanceId: string, details: string) {
    super(`Configuration validation failed for service instance "${instanceId}": ${details}`);
    this.name = 'ConfigValidationError';
  }
}
