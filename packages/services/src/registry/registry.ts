import { ServiceType, AdapterType } from './types.js';
import { vckitDidRegistryEntry } from '../did-manager/adapters/vckit/vckit-did.adapter.js';
import { pyxIdrRegistryEntry } from '../identity-resolver/adapters/pyx/pyx-idr.adapter.js';
import { uncefactStorageRegistryEntry } from '../storage/adapters/uncefact/uncefact-storage.adapter.js';

export const adapterRegistry = {
  [ServiceType.DID]: {
    [AdapterType.VCKIT]: vckitDidRegistryEntry,
  },
  [ServiceType.IDR]: {
    [AdapterType.PYX_IDR]: pyxIdrRegistryEntry,
  },
  [ServiceType.STORAGE]: {
    [AdapterType.UNCEFACT_STORAGE]: uncefactStorageRegistryEntry,
  },
} as const;
