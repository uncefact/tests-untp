import { z } from 'zod';

/**
 * Service instance record as returned by the REST API.
 *
 * The `config` field contains the adapter configuration with sensitive
 * fields masked (replaced with `'***'`).
 */
export const serviceInstanceResponseSchema = z.object({
  id: z.string().describe('Database ID of the service instance'),
  tenantId: z.string().describe('ID of the owning tenant'),
  serviceType: z.enum(['IDR', 'STORAGE', 'VC']).describe('Service category'),
  adapterType: z.enum(['VCKIT', 'PYX_IDR', 'UNCEFACT_STORAGE']).describe('Adapter implementation'),
  name: z.string().describe('Human-readable name'),
  description: z.string().nullable().describe('Description of the instance'),
  config: z.record(z.unknown()).describe('Adapter configuration (sensitive fields masked)'),
  isPrimary: z.boolean().describe('Whether this is the primary instance for its service type'),
  createdAt: z.string().datetime().describe('Timestamp when created'),
  updatedAt: z.string().datetime().describe('Timestamp when last updated'),
});
