import { adapterRegistry } from '../registry.js';

/**
 * Searches across all service types in the adapter registry and returns the
 * sensitive fields for the first matching adapter type.
 *
 * Returns an empty array if the adapter type is not found, meaning no fields
 * will be masked by {@link maskInstanceConfig}.
 */
export function getSensitiveFields(adapterType: string): readonly string[] {
  for (const serviceAdapters of Object.values(adapterRegistry)) {
    const entry = (serviceAdapters as Record<string, { sensitiveFields: readonly string[] }>)[adapterType];
    if (entry) return entry.sensitiveFields;
  }
  return [];
}
