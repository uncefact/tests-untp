import { AdapterType } from './types.js';
import { vckitDidRegistryEntry } from '../did-manager/adapters/vckit/vckit-did.adapter.js';

/**
 * Internal adapter registry for DID management.
 * Maps adapter types to DID adapter registry entries.
 *
 * DID management is not a separate service type; it uses VC service instances.
 * This registry provides the adapter entries needed to create DID adapters
 * from VC service instance configs.
 */
export const didAdapterRegistry = {
  [AdapterType.VCKIT]: vckitDidRegistryEntry,
};
