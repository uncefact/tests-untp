import { z } from 'zod';
import { requireAtLeastOneField } from './shared';
import { CREATABLE_DID_TYPES, DidMethod, DidType } from '@uncefact/untp-ri-services';

const creatableDidTypeSchema = z.enum([...CREATABLE_DID_TYPES] as [DidType, ...DidType[]]);

/** Request body for POST /dids. */
export const createDidRequestSchema = z.object({
  type: creatableDidTypeSchema,
  method: z.nativeEnum(DidMethod),
  alias: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  serviceInstanceId: z.string().min(1).optional(),
});

/** Request body for PATCH /dids/{id}. */
export const updateDidRequestSchema = requireAtLeastOneField(
  z.object({
    name: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    isDefault: z.boolean().optional(),
  }),
  'At least one of name, description, or isDefault is required',
);

/** Request body for POST /dids/import. */
export const importDidRequestSchema = z.object({
  did: z.string().min(1),
  method: z.nativeEnum(DidMethod),
  keyId: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  serviceInstanceId: z.string().min(1),
});
