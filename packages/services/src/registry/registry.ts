import { ServiceType, AdapterType } from './types.js';
import { vckitDidRegistryEntry } from '../did-manager/adapters/vckit-did.service.js';

export const adapterRegistry = {
  [ServiceType.DID]: {
    [AdapterType.VCKIT]: vckitDidRegistryEntry,
  },
} as const;
