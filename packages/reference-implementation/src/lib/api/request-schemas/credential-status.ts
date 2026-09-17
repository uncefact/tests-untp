import { CredentialStatusCapture, VcServiceAttribution } from '@/lib/prisma/generated';
import { credentialStatusEntrySchema } from '@/lib/library/credential-record-projection';
import { booleanQuerySchema } from './shared';
import { z } from 'zod';
import { ValidationError } from '@/lib/api/validation';

export const setCredentialStatusSchema = z.object({ value: z.boolean() });
export const reconcileCredentialStatusSchema = z.object({ acceptProviderChange: z.boolean().optional() });
export const readCredentialStatusQuerySchema = z.object({
  fresh: booleanQuerySchema.default('false'),
});

/** Next supplies decoded path parameters. Decoding again would change a literal percent escape. */
export function parseStatusPurpose(purpose: string): string {
  if (purpose.length === 0 || purpose.length > 255 || /[\u0000-\u001f\u007f]/.test(purpose)) {
    throw new ValidationError('purpose must contain 1 to 255 characters without control characters.');
  }
  return purpose;
}

export const credentialStatusObservationSchema = z
  .object({
    entryId: z.string(),
    statusPurpose: z.string(),
    value: z.boolean(),
    observedAt: z.string().datetime(),
    version: z.number().int().min(1),
  })
  .strict();

export const credentialStatusReadSchema = z
  .object({
    capture: z.nativeEnum(CredentialStatusCapture),
    statusCaptureError: z.string().nullable(),
    attribution: z
      .object({
        instanceId: z.string(),
        source: z.nativeEnum(VcServiceAttribution).nullable(),
        at: z.string().datetime().nullable(),
      })
      .strict()
      .nullable(),
    entries: z.array(credentialStatusEntrySchema.omit({ statusListCredential: true, statusListIndex: true })),
    observed: z.array(credentialStatusObservationSchema.omit({ version: true })).optional(),
    failures: z
      .array(
        z.object({ entryId: z.string(), statusPurpose: z.string(), code: z.string(), message: z.string() }).strict(),
      )
      .optional(),
  })
  .strict();
