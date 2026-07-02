import { z } from 'zod';
import { requireAtLeastOneField } from './shared';

/** Request body for POST /registrars. */
export const createRegistrarRequestSchema = z.object({
  name: z.string().min(1),
  namespace: z.string().min(1),
  url: z.string().min(1),
  idrServiceInstanceId: z.string().min(1).optional(),
});

/** Request body for PATCH /registrars/{id}. idrServiceInstanceId set to null clears it. */
export const updateRegistrarRequestSchema = requireAtLeastOneField(
  z.object({
    name: z.string().min(1).optional(),
    namespace: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    idrServiceInstanceId: z.string().min(1).nullable().optional(),
  }),
  'At least one of name, namespace, url, or idrServiceInstanceId is required',
);
