import { ServiceType, AdapterType } from './types.js';
import { vckitDidRegistryEntry } from '../did-manager/adapters/vckit/vckit-did.adapter.js';
import { pyxIdrRegistryEntry } from '../adapters/identity-resolver/pyxIdentityResolver.adapter.js';

export const adapterRegistry = {
  [ServiceType.DID]: {
    [AdapterType.VCKIT]: vckitDidRegistryEntry,
  },
  [ServiceType.IDR]: {
    [AdapterType.PYX_IDR]: pyxIdrRegistryEntry,
  },
} as const;
