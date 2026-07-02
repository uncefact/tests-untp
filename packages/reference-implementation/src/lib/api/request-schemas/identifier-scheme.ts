import { z } from 'zod';
import { requireAtLeastOneField } from './shared';

const qualifierSchema = z.object({
  key: z.string().min(1),
  description: z.string().min(1),
  validationPattern: z.string().min(1),
  order: z.number().int().optional(),
});

/** Request body for POST /schemes. */
export const createIdentifierSchemeRequestSchema = z.object({
  registrarId: z.string().min(1),
  name: z.string().min(1),
  primaryKey: z.string().min(1),
  validationPattern: z.string().min(1),
  linkTemplate: z.string().min(1),
  idrServiceInstanceId: z.string().min(1).optional(),
  qualifiers: z.array(qualifierSchema).optional(),
});

/** Request body for PATCH /schemes/{id}. idrServiceInstanceId set to null clears it. */
export const updateIdentifierSchemeRequestSchema = requireAtLeastOneField(
  z.object({
    name: z.string().min(1).optional(),
    primaryKey: z.string().min(1).optional(),
    validationPattern: z.string().min(1).optional(),
    linkTemplate: z.string().min(1).optional(),
    idrServiceInstanceId: z.string().min(1).nullable().optional(),
    qualifiers: z.array(qualifierSchema).optional(),
  }),
  'At least one field is required',
);
