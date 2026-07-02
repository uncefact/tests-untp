import { z } from 'zod';
import { requireAtLeastOneField } from './shared';
import { ServiceType, AdapterType } from '@uncefact/untp-ri-services';

/**
 * Request body for POST /services. The adapter-specific config content is
 * validated separately against the adapter's own schema in the route.
 */
export const createServiceInstanceRequestSchema = z.object({
  serviceType: z.nativeEnum(ServiceType),
  adapterType: z.nativeEnum(AdapterType),
  name: z.string().min(1),
  description: z.string().optional(),
  config: z.record(z.unknown()),
  isPrimary: z.boolean().optional(),
});

/** Request body for PATCH /services/{id}. */
export const updateServiceInstanceRequestSchema = requireAtLeastOneField(
  z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    config: z.record(z.unknown()).optional(),
    isPrimary: z.boolean().optional(),
  }),
  'At least one of name, description, config, or isPrimary is required',
);
