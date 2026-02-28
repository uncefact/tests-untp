import { ServiceType, AdapterType } from './types.js';
import { pyxIdrRegistryEntry } from '../identity-resolver/adapters/pyx/pyx-idr.adapter.js';
import { uncefactStorageRegistryEntry } from '../storage/adapters/uncefact/uncefact-storage.adapter.js';
import { vckitVerifiableCredentialRegistryEntry } from '../verifiable-credential/adapters/vckit/vckit-verifiable-credential.adapter.js';

export const adapterRegistry = {
  [ServiceType.IDR]: {
    [AdapterType.PYX_IDR]: pyxIdrRegistryEntry,
  },
  [ServiceType.STORAGE]: {
    [AdapterType.UNCEFACT_STORAGE]: uncefactStorageRegistryEntry,
  },
  [ServiceType.VC]: {
    [AdapterType.VCKIT]: vckitVerifiableCredentialRegistryEntry,
  },
} as const;
