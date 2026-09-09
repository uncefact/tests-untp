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

/** The UNTP encrypted-link key: AES-256-GCM, 32 bytes as 64 hex characters, the same rule the verify route applies. */
const HEX_64 = /^[a-f0-9]{64}$/i;

/**
 * A calendar date as `YYYY-MM-DD` that names a real day (zod's `date()`
 * rejects `2026-02-30` and publishes `format: date`), kept as the string it
 * arrived as; the route turns it into the `Date` the column stores.
 */
export const calendarDateSchema = z.string().date('must be a real calendar date in YYYY-MM-DD form');

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
    displayName: boundedNonBlank(REGISTER_DISPLAY_NAME_MAX_LENGTH).describe(
      "The recipient's own label for this record; not only whitespace. Never presented as part of the verified credential.",
    ),
    declaredCredentialType: z
      .nativeEnum(CoreCredentialType)
      .describe(
        'The core credential type the recipient believes this is. A mismatch with the extracted type is a warning, never a failure.',
      ),
    dateReceived: calendarDateSchema
      .optional()
      .describe('When the recipient received the credential, as a calendar date.'),
    notes: z.string().max(REGISTER_NOTES_MAX_LENGTH).optional().describe('Free text kept with the record.'),
  }),
});

const annotationShape = registerExternalCredentialRequestSchema.shape.annotations.shape;
const annotationNulMessage = 'must not contain a NUL character';
const annotationCredentialTypeErrorMap = () => ({
  message: `must be one of ${Object.values(CoreCredentialType).join(', ')}`,
});

/**
 * Recipient annotation fields accepted by PATCH /library/{id}.
 *
 * `displayName`, `dateReceived` and `notes` are the register fields, so their
 * bounds and their published descriptions are inherited rather than restated.
 * The patch semantics added on top are the two nullable wrappers: `null` clears
 * the two optional stored columns, while an omitted field is left untouched by
 * the repository.
 *
 * Two rules here are new to this route and are not shared with registration.
 * The NUL refinement on `displayName` and `notes` rejects a character
 * PostgreSQL cannot store, which the register schema still accepts and fails on
 * at the write; moving the rule onto the shared field definitions is a recorded
 * follow-up. And `declaredCredentialType` is not inherited at all: it is a
 * fresh `nativeEnum` carrying an error map that names the permitted values
 * instead of quoting the submitted one, with only the register description
 * copied across. A change to the register enum's constraints does not reach
 * this field.
 */
/**
 * The NUL rule is a refinement, and the OpenAPI converter cannot express one,
 * so the two refined fields carry it in their published descriptions instead.
 * The sentence is appended to the inherited register description; a register
 * field that lost its own description publishes the rule alone rather than a
 * fragment behind a leading space.
 */
const NUL_RULE_SENTENCE = 'The value cannot contain a NUL character.';
function withNulRule(description: string | undefined): string {
  return description ? `${description} ${NUL_RULE_SENTENCE}` : NUL_RULE_SENTENCE;
}

const declaredCredentialTypeDescription = annotationShape.declaredCredentialType.description;
const declaredCredentialTypeSchema = z
  .nativeEnum(CoreCredentialType, { errorMap: annotationCredentialTypeErrorMap })
  .optional();

const updateAnnotationFieldsSchema = z.object({
  displayName: annotationShape.displayName
    .refine((value) => !value.includes('\0'), { message: annotationNulMessage })
    .optional()
    .describe(withNulRule(annotationShape.displayName.description)),
  // Described only when the register field carries a description, so a register
  // field that lost its own publishes no description here rather than an empty
  // one.
  declaredCredentialType: declaredCredentialTypeDescription
    ? declaredCredentialTypeSchema.describe(declaredCredentialTypeDescription)
    : declaredCredentialTypeSchema,
  dateReceived: annotationShape.dateReceived.nullable().optional(),
  notes: annotationShape.notes
    .nullable()
    .refine((value) => value === null || value === undefined || !value.includes('\0'), {
      message: annotationNulMessage,
    })
    .optional()
    .describe(withNulRule(annotationShape.notes.description)),
});

export const updateLibraryAnnotationsRequestSchema = requireAtLeastOneField(
  updateAnnotationFieldsSchema,
  'At least one of displayName, declaredCredentialType, dateReceived, or notes is required',
);

export type UpdateLibraryAnnotationsRequest = z.infer<typeof updateLibraryAnnotationsRequestSchema>;

export type RegisterExternalCredentialRequest = z.infer<typeof registerExternalCredentialRequestSchema>;
