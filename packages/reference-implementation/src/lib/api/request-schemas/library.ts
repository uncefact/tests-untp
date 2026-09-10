import { z } from 'zod';
import { CoreCredentialType } from '@/lib/prisma/generated';
import { originSchema, verificationSummarySchema } from '@/lib/library/credential-record-projection';
import { LIBRARY_LIST_SORTS } from '@/lib/prisma/repositories/library-record.repository';
import {
  booleanQuerySchema,
  nonBlankString,
  paginationLimitQueryParam,
  paginationQuerySchema,
  requireAtLeastOneField,
  urlSchema,
} from './shared';
import { MAX_PAGE_LIMIT } from '@/lib/api/pagination';
import { MAX_BATCH_LIMIT } from '@/lib/api/batch-limits';

/**
 * The shared non-blank rule with a length bound applied before it, because a
 * refined schema cannot be bounded after. The whitespace rule is a
 * refinement the published component cannot carry, so each field's
 * description states it.
 */
function boundedNonBlank(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, { message: 'must not be only whitespace' });
}

/** The bounds the register route holds its text fields to (ADR-037). */
export const REGISTER_SOURCE_URL_MAX_LENGTH = 2048;
export const REGISTER_DISPLAY_NAME_MAX_LENGTH = 200;
export const REGISTER_NOTES_MAX_LENGTH = 2000;

/**
 * The UNTP encrypted-link key: AES-256-GCM, 32 bytes as 64 hex characters,
 * the same rule the verify route applies.
 *
 * The character class states both cases rather than relying on the `i` flag
 * alone. `zod-to-json-schema` drops the flag when it emits the `pattern` for
 * the published request components, so the document advertised
 * `^[a-f0-9]{64}$` while the runtime accepted uppercase: a generated client
 * or a schema-validating gateway would have refused a key this endpoint
 * takes. The flag is kept as well, so the emitted pattern and the enforced
 * rule now say the same thing whichever half a reader looks at.
 */
const HEX_64 = /^[a-fA-F0-9]{64}$/i;

/**
 * A calendar date as `YYYY-MM-DD` that names a real day (zod's `date()`
 * rejects `2026-02-30` and publishes `format: date`), kept as the string it
 * arrived as; the route turns it into the `Date` the column stores.
 */
export const calendarDateSchema = z.string().date('must be a real calendar date in YYYY-MM-DD form');

const batchGetStructureSchema = z.object({
  ids: z
    .array(z.string({ invalid_type_error: 'must be a string' }).min(1, 'must not be empty'), {
      required_error: 'is required',
      invalid_type_error: 'must be an array',
    })
    .min(1, 'must contain at least one id')
    .describe("Bounded by the deployment's configured maximum (default 500); see the operation description"),
});

const batchGetLimitSchema = z.object({ ids: z.array(z.string()) }).superRefine((body, ctx) => {
  if (body.ids.length > MAX_BATCH_LIMIT) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ids'],
      message: `submit no more than ${MAX_BATCH_LIMIT} ids per request`,
      params: { code: 'BATCH_GET_LIMIT_EXCEEDED' },
    });
  }
});

export const batchGetLibraryRequestSchema = batchGetStructureSchema.pipe(batchGetLimitSchema);

export type BatchGetLibraryRequest = z.infer<typeof batchGetLibraryRequestSchema>;

const libraryListCalendarDateSchema = calendarDateSchema.refine((value) => !value.startsWith('0000-'), {
  message: 'year must be 0001 or later',
});

const librarySortSchema = z.enum(LIBRARY_LIST_SORTS);

const libraryPaginationQuerySchema = paginationQuerySchema.extend({
  limit: paginationLimitQueryParam,
});

/**
 * Query parameters for `GET /library`. `type` is an OpenAPI repeatable
 * parameter and is therefore an array even when the caller supplies one
 * value. The extracted core type is authoritative once it is present; the
 * repository applies that distinction when it builds the SQL predicate.
 */
export const listLibraryQuerySchema = z
  .object({
    type: z.array(z.nativeEnum(CoreCredentialType)).min(1).optional(),
    origin: originSchema.optional(),
    organisationId: nonBlankString.optional(),
    facilityId: nonBlankString.optional(),
    productId: nonBlankString.optional(),
    issuer: nonBlankString.optional(),
    encrypted: booleanQuerySchema,
    status: verificationSummarySchema.optional(),
    issuedFrom: libraryListCalendarDateSchema.optional(),
    issuedTo: libraryListCalendarDateSchema.optional(),
    sort: librarySortSchema.default('issuedAt:desc'),
    q: z.string().optional(),
  })
  .merge(libraryPaginationQuerySchema)
  .superRefine((query, ctx) => {
    if (query.issuedFrom !== undefined && query.issuedTo !== undefined && query.issuedFrom > query.issuedTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['issuedFrom'],
        message: 'must be on or before issuedTo',
      });
    }
    if (query.limit !== undefined && query.limit > MAX_PAGE_LIMIT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limit'],
        message: `must not exceed the maximum of ${MAX_PAGE_LIMIT}`,
        params: { code: 'PAGE_LIMIT_EXCEEDED' },
      });
    }
  });

export type ListLibraryQuery = z.infer<typeof listLibraryQuerySchema>;

/**
 * Supplied when the caller believes the source is encrypted; the fetch is
 * what confirms it. The key is used for this request and forgotten: it is
 * never stored, logged, enqueued or returned (ADR-055 decision 1).
 */
export const sourceEncryptionSchema = z.object({
  decryptionKey: z
    .string()
    .regex(HEX_64, { message: 'must be an AES-256-GCM key as 64 hexadecimal characters' })
    .describe(
      'The AES-256-GCM key that opens the source, as 64 hexadecimal characters. Used for this request only; never stored or returned.',
    ),
  encryptionMethod: boundedNonBlank(REGISTER_DISPLAY_NAME_MAX_LENGTH)
    .optional()
    .describe(
      'Accepted for compatibility with the contract and not currently used: the envelope names its own algorithm. Never persisted or returned.',
    ),
});

const annotationNulMessage = 'must not contain a NUL character';

// PostgreSQL refuses a NUL byte inside a text value (SQLSTATE 22021), so the boundary rejects one rather than letting the write fail.
function annotationContainsNoNul(value: string): boolean {
  return !value.includes('\0');
}

const annotationCredentialTypeMessage = `must be one of ${Object.values(CoreCredentialType).join(', ')}`;
const annotationCredentialTypeErrorMap = () => ({ message: annotationCredentialTypeMessage });
// The NUL rule is a refinement, which the OpenAPI converter cannot express, so
// the refined fields append it to their published descriptions, and PATCH
// inherits the sentence with the field.
const NUL_RULE_SENTENCE = 'The value cannot contain a NUL character.';

function withNulRule(description: string): string {
  return `${description} ${NUL_RULE_SENTENCE}`;
}

/**
 * Request body for the late-key re-verification form. The endpoint accepts
 * only the key, not the registration route's optional method hint. Unknown
 * fields are stripped by the object schema after this required nested object
 * has been validated.
 */
export const verifyLibraryRecordRequestSchema = z.object({
  sourceEncryption: sourceEncryptionSchema.pick({ decryptionKey: true }),
});

export type VerifyLibraryRecordRequest = z.infer<typeof verifyLibraryRecordRequestSchema>;

/**
 * Request body for `POST /library`. Mirrors `RegisterExternalCredentialRequest`
 * in the discovery contract: a source location, the recipient's own
 * annotations, and an optional key.
 */
export const registerExternalCredentialRequestSchema = z.object({
  // The bound is applied before the URL rule so it reaches the published
  // component; a bound refined onto the URL schema would be enforced and
  // not documented.
  sourceUrl: z
    .string()
    .max(REGISTER_SOURCE_URL_MAX_LENGTH)
    .pipe(urlSchema)
    .describe('Where to fetch the credential from. An absolute http(s) URL without embedded credentials.'),
  sourceEncryption: sourceEncryptionSchema.optional(),
  annotations: z.object({
    displayName: boundedNonBlank(REGISTER_DISPLAY_NAME_MAX_LENGTH)
      .refine(annotationContainsNoNul, { message: annotationNulMessage })
      .describe(
        withNulRule(
          "The recipient's own label for this record; not only whitespace. Never presented as part of the verified credential.",
        ),
      ),
    declaredCredentialType: z
      .nativeEnum(CoreCredentialType, { errorMap: annotationCredentialTypeErrorMap })
      .describe(
        'The core credential type the recipient believes this is. A mismatch with the extracted type is a warning, never a failure.',
      ),
    dateReceived: calendarDateSchema
      .optional()
      .describe('When the recipient received the credential, as a calendar date.'),
    notes: z
      .string()
      .max(REGISTER_NOTES_MAX_LENGTH)
      .refine(annotationContainsNoNul, { message: annotationNulMessage })
      .optional()
      .describe(withNulRule('Free text kept with the record.')),
  }),
});

const annotationShape = registerExternalCredentialRequestSchema.shape.annotations.shape;

/**
 * Recipient annotation fields accepted by PATCH /library/{id}.
 *
 * All four fields are the register definitions, so their bounds, their NUL
 * rule, their value-free declared-type message and their published
 * descriptions are inherited rather than restated. The only additions are the
 * PATCH wrappers: `null` clears the two optional stored columns, and an omitted
 * field is left untouched by the repository.
 */
const updateAnnotationFieldsSchema = z.object({
  displayName: annotationShape.displayName.optional(),
  declaredCredentialType: annotationShape.declaredCredentialType.optional(),
  dateReceived: annotationShape.dateReceived.nullable().optional(),
  notes: annotationShape.notes.nullable(),
});

export const updateLibraryAnnotationsRequestSchema = requireAtLeastOneField(
  updateAnnotationFieldsSchema,
  'At least one of displayName, declaredCredentialType, dateReceived, or notes is required',
);

export type UpdateLibraryAnnotationsRequest = z.infer<typeof updateLibraryAnnotationsRequestSchema>;

export type RegisterExternalCredentialRequest = z.infer<typeof registerExternalCredentialRequestSchema>;
