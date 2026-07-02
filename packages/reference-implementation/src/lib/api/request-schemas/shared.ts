/**
 * Zod request-body schemas for write routes, one file per resource (ADR-037).
 *
 * Routes parse bodies with parseRequestBody from '@/lib/api/validation' and
 * import schemas from the resource file directly (no barrel index; a barrel
 * transitively loads every resource's dependencies, which breaks tests that
 * mock those packages). Schemas validate shape and type only; referential
 * checks (existence, tenant scoping) stay in repositories and services.
 */

import { z } from 'zod';

/** A database identifier reference (non-empty string). */
export const idSchema = z.string().min(1);

/**
 * UNTP location object, accepted as an open JSON object. No field-level
 * validation is applied anywhere today; a UNTP-shaped location schema is a
 * tracked follow-up.
 */
export const locationSchema = z.record(z.unknown());

/** Wraps an update-body schema so a body providing no fields is rejected. */
export function requireAtLeastOneField<Schema extends z.SomeZodObject>(schema: Schema, message: string) {
  return schema.refine((body) => Object.values(body).some((value) => value !== undefined), { message });
}

/** A bulk-create request body: a non-empty array of items. */
export function nonEmptyArraySchema<Item extends z.ZodTypeAny>(itemSchema: Item) {
  return z
    .array(itemSchema, { invalid_type_error: 'Request body must be an array' })
    .min(1, 'Request body must not be empty');
}
