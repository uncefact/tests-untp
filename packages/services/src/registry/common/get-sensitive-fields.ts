import { adapterRegistry } from '../registry.js';

/**
 * Looks up the sensitive fields for an adapter type from the registry.
 * Returns an empty array if the adapter type is not found.
 */
export function getSensitiveFields(adapterType: string): readonly string[] {
  for (const serviceAdapters of Object.values(adapterRegistry)) {
    const entry = (serviceAdapters as Record<string, { sensitiveFields: readonly string[] }>)[adapterType];
    if (entry) return entry.sensitiveFields;
  }
  return [];
}
