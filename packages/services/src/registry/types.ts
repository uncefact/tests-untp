import { z } from 'zod';
import { DID_SERVICE_TYPE } from '../did-manager/types.js';
import { VCKIT_DID_ADAPTER_TYPE } from '../did-manager/adapters/vckit/vckit-did.adapter.js';

// Mirror Prisma enums as string constants (packages/services cannot import Prisma)
export const ServiceType = {
  DID: DID_SERVICE_TYPE,
} as const;
export type ServiceType = (typeof ServiceType)[keyof typeof ServiceType];

export const AdapterType = {
  VCKIT: VCKIT_DID_ADAPTER_TYPE,
} as const;
export type AdapterType = (typeof AdapterType)[keyof typeof AdapterType];

export interface AdapterRegistryEntry<TConfig = unknown, TService = unknown> {
  configSchema: z.ZodType<TConfig, z.ZodTypeDef, any>;
  factory: (config: TConfig) => TService;
}

export type AdapterRegistry = {
  [S in ServiceType]?: {
    [A in AdapterType]?: AdapterRegistryEntry;
  };
};
