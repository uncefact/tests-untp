import { z } from 'zod';
import type { LoggerService } from '../logging/types.js';
import { DID_SERVICE_TYPE } from '../did-manager/types.js';
import { VCKIT_DID_ADAPTER_TYPE } from '../did-manager/adapters/vckit/vckit-did.adapter.js';
import { IDR_SERVICE_TYPE } from '../identity-resolver/types.js';
import { PYX_IDR_ADAPTER_TYPE } from '../identity-resolver/adapters/pyx/pyx-idr.adapter.js';
import { STORAGE_SERVICE_TYPE } from '../storage/types.js';
import { UNCEFACT_STORAGE_ADAPTER_TYPE } from '../storage/adapters/uncefact/uncefact-storage.adapter.js';

// Mirror Prisma enums as string constants (packages/services cannot import Prisma)
export const ServiceType = {
  DID: DID_SERVICE_TYPE,
  IDR: IDR_SERVICE_TYPE,
  STORAGE: STORAGE_SERVICE_TYPE,
} as const;
export type ServiceType = (typeof ServiceType)[keyof typeof ServiceType];

export const AdapterType = {
  VCKIT: VCKIT_DID_ADAPTER_TYPE,
  PYX_IDR: PYX_IDR_ADAPTER_TYPE,
  UNCEFACT_STORAGE: UNCEFACT_STORAGE_ADAPTER_TYPE,
} as const;
export type AdapterType = (typeof AdapterType)[keyof typeof AdapterType];

export interface AdapterRegistryEntry<TConfig = unknown, TService = unknown> {
  configSchema: z.ZodType<TConfig, z.ZodTypeDef, any>;
  factory: (config: TConfig, logger: LoggerService) => TService;
}

export type AdapterRegistry = {
  [S in ServiceType]?: {
    [A in AdapterType]?: AdapterRegistryEntry;
  };
};
