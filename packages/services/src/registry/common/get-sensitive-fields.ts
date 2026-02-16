import { adapterRegistry } from '../registry.js';

/**
 * Looks up the sensitive fields for a specific service type and adapter type
 * combination in the adapter registry.
 *
 * Returns an empty array if the combination is not found, meaning no fields
 * will be masked by {@link maskInstanceConfig}.
 */
export function getSensitiveFields(serviceType: string, adapterType: string): readonly string[] {
  const serviceAdapters = (
    adapterRegistry as Record<string, Record<string, { sensitiveFields: readonly string[] }> | undefined>
  )[serviceType];
  return serviceAdapters?.[adapterType]?.sensitiveFields ?? [];
}
