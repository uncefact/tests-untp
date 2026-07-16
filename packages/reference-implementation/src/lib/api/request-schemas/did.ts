import { z } from 'zod';
import { CREATABLE_DID_TYPES, DidMethod, DidStatus, DidType } from '@uncefact/untp-ri-services';
import { idSchema, paginationQuerySchema, requireAtLeastOneField } from './shared';

/**
 * DID types creatable via POST /dids, a subset of DidType that excludes
 * DEFAULT (system-managed). Mirrors CREATABLE_DID_TYPES from the did-manager
 * service so the code list stays single-source; the GET /dids query `type`
 * filter validates against the full DidType enum instead, since a client can
 * filter by any type including DEFAULT.
 */
const creatableDidTypeSchema = z.enum(CREATABLE_DID_TYPES);

/**
 * Request body for POST /dids. Domain-membership checks against the
 * resolved DID service's actual capabilities (getSupportedTypes,
 * getSupportedMethods) stay in the route handler (ADR-037): this schema
 * only checks that `type` and `method` are members of their respective
 * code lists.
 *
 * `name`/`description` reject an empty string with a 400; previously these
 * fields had no runtime check and an empty string was silently accepted and
 * stored. An explicit JSON `null` is also rejected (400): omission is the
 * only way to leave an optional field unset, since neither field has
 * clearing semantics on create.
 */
export const createDidRequestSchema = z.object({
  type: creatableDidTypeSchema,
  method: z.nativeEnum(DidMethod),
  alias: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  isDefault: z.boolean().optional(),
  serviceInstanceId: idSchema.optional(),
});

/**
 * Request body for POST /dids/import.
 *
 * `name`/`description` reject an empty string with a 400 (previously
 * unvalidated and silently accepted) and reject an explicit JSON `null` the
 * same way as {@link createDidRequestSchema}, for the same reason: omission,
 * not null, is how an optional field is left unset here.
 */
export const importDidRequestSchema = z.object({
  did: z.string().min(1),
  method: z.nativeEnum(DidMethod),
  keyId: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  serviceInstanceId: idSchema,
});

/**
 * Request body for PATCH /dids/{id}.
 *
 * `name`/`description` reject an empty string with a 400; the previous
 * handler treated an empty string as "not provided" and silently dropped it
 * from the update instead of failing. An explicit JSON `null` is also
 * rejected (400): neither field is a nullable FK with clear-via-null
 * semantics, so omission is the only way to leave a field unchanged.
 */
export const updateDidRequestSchema = requireAtLeastOneField(
  z.object({
    name: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    isDefault: z.boolean().optional(),
  }),
  'At least one of name, description, or isDefault is required',
);

/** Query parameters for GET /dids. */
export const listDidsQuerySchema = z
  .object({
    type: z.nativeEnum(DidType).optional(),
    status: z.nativeEnum(DidStatus).optional(),
    serviceInstanceId: idSchema.optional(),
  })
  .merge(paginationQuerySchema);
