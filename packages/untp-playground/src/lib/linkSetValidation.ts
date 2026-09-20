/**
 * Link set schema validation (#988).
 *
 * A link set is validated against the UNTP Identity Resolver linkset JSON Schema for the spec
 * version the verifier selected, fetched through the guarded `/api/schema` route like every other
 * schema. Three outcomes are kept apart because they mean different things to the verifier: the
 * document broke the schema (raw AJV errors, every violation kept), the schema could not be
 * loaded (nothing was assessed; the reason says whether a retry can help), or the schema loaded
 * but could not be compiled (nothing was assessed; retrying will not help, the operator needs to
 * know).
 *
 * The published schema is draft-07, so this module supplies a draft-07 Ajv
 * instance to the shared schema pre-check and document validator.
 */

import { buildLinkSetSchemaUrl } from '@uncefact/untp-utils/artefacts';
import type { ErrorObject, ValidateFunction } from 'ajv';
import Ajv from 'ajv';
import type { TestStep } from '@/types';
import { TestCaseStatus, TestCaseStepId } from '../../constants';
import { classifySchemaFetchFailure, describeArtefactFailure, type ArtefactStepFailure } from './artefactFailure';
import { formatValidationError, pointerSegments } from './formatValidationErrors';
import { fetchSchema, SchemaFetchError, type SchemaFetchReason } from './schemaFetch';
import { validateSchemaDocument } from './schemaValidation';

export { buildLinkSetSchemaUrl as linkSetSchemaUrl };

type CompiledLinkSetSchema = { schema: unknown; validator: Ajv; validate: ValidateFunction };

// The published draft-07 schema is keyed by URL and remains stable for a browser session.
// Keeping the schema identity with the validator avoids reusing a compiled validator for a
// replaced response while allowing repeated validations of the same fetched schema to reuse it.
const compiledSchemaCache = new Map<string, CompiledLinkSetSchema>();

/** A validation attempt. `version` and `schemaUrl` are recorded on every outcome, including failures to assess. */
export type LinkSetSchemaResult =
  | {
      kind: 'document';
      valid: boolean;
      errors: ErrorObject[];
      version: string;
      schemaUrl: string;
      failure?: ArtefactStepFailure;
    }
  | {
      kind: 'schema-unavailable';
      reason: SchemaFetchReason;
      message: string;
      version: string;
      schemaUrl: string;
      failure?: ArtefactStepFailure;
    }
  | {
      kind: 'schema-unusable';
      message: string;
      version: string;
      schemaUrl: string;
      errors?: ErrorObject[];
      failure?: ArtefactStepFailure;
    };

/**
 * What the Schema Validation step stores in `details`: the attempt minus the `valid` flag, which
 * the step status already carries. Derived from the result type so the two cannot drift.
 */
export type LinkSetSchemaStepDetails = LinkSetSchemaResult extends infer R
  ? R extends { kind: 'document' }
    ? Omit<R, 'valid'>
    : R
  : never;

export function toLinkSetSchemaStepDetails(result: LinkSetSchemaResult): LinkSetSchemaStepDetails {
  if (result.kind === 'document') {
    const { valid: _valid, ...rest } = result;
    return rest;
  }
  return result;
}

/**
 * Narrows a step's untyped `details` back to the shape this module wrote, checking the fields each
 * variant must carry. One accessor here means the card and the report (#814) read the same
 * contract instead of each casting; a partial object (a `kind` with no attempt fields) is not
 * an attempt this module recorded and reads as absent.
 */
export function linkSetSchemaStepDetails(step: TestStep): LinkSetSchemaStepDetails | undefined {
  const details = step.details as
    | Partial<Record<'kind' | 'version' | 'schemaUrl' | 'errors' | 'reason' | 'message' | 'failure', unknown>>
    | undefined;
  if (!details || typeof details.version !== 'string' || typeof details.schemaUrl !== 'string') return undefined;
  if (details.kind === 'document' && Array.isArray(details.errors)) return details as LinkSetSchemaStepDetails;
  if (
    details.kind === 'schema-unavailable' &&
    typeof details.message === 'string' &&
    typeof details.reason === 'string'
  ) {
    return details as LinkSetSchemaStepDetails;
  }
  if (details.kind === 'schema-unusable' && typeof details.message === 'string')
    return details as LinkSetSchemaStepDetails;
  return undefined;
}

export async function validateLinkSetSchema(document: unknown, version: string): Promise<LinkSetSchemaResult> {
  const schemaUrl = buildLinkSetSchemaUrl(version);

  let schema: unknown;
  try {
    schema = await fetchSchema(schemaUrl);
  } catch (err) {
    if (err instanceof SchemaFetchError) {
      return {
        kind: 'schema-unavailable',
        reason: err.reason,
        message: err.message,
        version,
        schemaUrl,
        failure: classifySchemaFetchFailure(err, 'link-set'),
      };
    }
    throw err;
  }

  const cached = compiledSchemaCache.get(schemaUrl);
  const cachedForSchema = cached?.schema === schema ? cached : undefined;
  const validatorAjv = cachedForSchema
    ? cachedForSchema.validator
    : new Ajv({ allErrors: true, strict: false, validateFormats: false, verbose: true });
  const compiledValidator = cachedForSchema?.validate;
  let newlyCompiled: ValidateFunction | undefined;
  const validation = validateSchemaDocument(
    schema,
    document,
    schemaUrl,
    'link-set',
    {
      compiledValidator,
      onCompiled: (validate) => {
        newlyCompiled = validate;
      },
    },
    validatorAjv,
    'http://json-schema.org/draft-07/schema',
  );
  if (newlyCompiled) compiledSchemaCache.set(schemaUrl, { schema, validator: validatorAjv, validate: newlyCompiled });
  if (validation.failure && validation.failure.class !== 'credential-invalid') {
    return {
      kind: 'schema-unusable',
      message: validation.failure.message,
      ...(validation.errors && validation.errors.length > 0 ? { errors: validation.errors as ErrorObject[] } : {}),
      version,
      schemaUrl,
      failure: validation.failure,
    };
  }
  const valid = validation.valid;
  const errors = (validation.errors ?? []) as ErrorObject[];
  return {
    kind: 'document',
    valid,
    errors,
    version,
    schemaUrl,
    ...(validation.failure ? { failure: validation.failure } : {}),
  };
}

/** The fresh step list a link set run starts from. */
export function linkSetValidationSteps(): TestStep[] {
  return [
    {
      id: TestCaseStepId.LINKSET_SCHEMA_VALIDATION,
      name: 'Schema Validation',
      status: TestCaseStatus.PENDING,
    },
  ];
}

/**
 * The v0.7.0 schema names link relations by a pattern (a lowercase name of letters and hyphens
 * outside the `anchor`, `description` and `itemDescription` prefixes, or an http(s) URL of
 * letters, digits, dots and slashes) and refuses every other member of a
 * link context as an unknown field. To the verifier, "Unknown field: untp:dpp" reads as a typo;
 * the rejected member is in fact a relation the published schema does not admit, so the message
 * says so. The rule is applied only to context-level additionalProperties errors, and only to
 * describe the error, never to re-validate.
 */
function isRelationRejection(error: ErrorObject, decoded: Record<string, unknown>): boolean {
  if (error.keyword !== 'additionalProperties') return false;
  const segments = pointerSegments(error.instancePath);
  if (segments.length !== 2 || segments[0] !== 'linkset') return false;
  // Relation-shaped means the rejected member holds an array of link targets, which is what a
  // relation is under RFC 9264; a scalar or object member (`lastUpdated`, `@context`) is an
  // ordinary unknown field and gets the ordinary sentence.
  const contexts = (decoded as { linkset?: unknown }).linkset;
  const context = Array.isArray(contexts) ? contexts[Number(segments[1])] : undefined;
  const key = String((error.params as { additionalProperty?: unknown })?.additionalProperty);
  return typeof context === 'object' && context !== null && Array.isArray((context as Record<string, unknown>)[key]);
}

export interface SchemaStepMessage {
  text: string;
  /** The rejected member is a relation the published schema does not admit (see isRelationRejection). */
  relationRule?: true;
}

export interface LinkSetSchemaMessageError {
  message: string;
  pointer?: string;
  relationRule?: true;
}

/** Adapts link-set schema failures to the shared validation drawer's message-error shape. */
export function schemaStepDialogErrors(
  details: LinkSetSchemaStepDetails | undefined,
  decoded: Record<string, unknown>,
): Array<ErrorObject | LinkSetSchemaMessageError> {
  if (!details || details.kind !== 'document') return [];

  const relationMessages = schemaStepMessages(details, decoded).filter((message) => message.relationRule);
  let relationIndex = 0;
  return details.errors.map((error) => {
    if (!isRelationRejection(error, decoded)) {
      return error.keyword === 'additionalProperties'
        ? { message: formatValidationError(error), pointer: error.instancePath }
        : error;
    }
    const relationMessage = relationMessages[relationIndex++]?.text ?? formatValidationError(error);
    return {
      message: `${relationMessage} Any credential links listed on this card can still be verified.`,
      pointer: error.instancePath,
      relationRule: true,
    };
  });
}

/**
 * The verifier-facing explanation of a Schema Validation step's details, shared by the card and
 * the downloadable report (#814) so the two never explain the same failure differently. The text
 * is neutral about where it is read: the card appends its own Verify hint to a relation-rule
 * message, because the report has no Verify action.
 */
export function schemaStepMessages(
  details: LinkSetSchemaStepDetails | undefined,
  decoded: Record<string, unknown>,
): SchemaStepMessage[] {
  if (!details) return [];

  if (details.failure) {
    const presentation = describeArtefactFailure(details.failure, 'link-set');
    if (presentation) {
      const messages: SchemaStepMessage[] = [
        { text: `${presentation.heading}: ${presentation.message}` },
        { text: `Next step: ${presentation.remediation}` },
      ];
      if (details.kind === 'document' && details.failure.class === 'credential-invalid') {
        messages.push(
          ...details.errors.map((error: ErrorObject) =>
            isRelationRejection(error, decoded)
              ? {
                  text: `${formatValidationError(error)}. The published UNTP v${
                    details.version
                  } schema rejects the relation "${String(
                    error.params?.additionalProperty,
                  )}". This error concerns the relation name only.`,
                  relationRule: true as const,
                }
              : { text: formatValidationError(error) },
          ),
        );
      } else if (details.kind === 'schema-unusable' && details.errors) {
        messages.push(
          ...details.errors.map((error) => ({ text: `Schema diagnostic: ${formatValidationError(error)}` })),
        );
      }
      return messages;
    }
  }

  if (details.kind === 'schema-unavailable') {
    // The bundled copy already stood in server-side for anything the host could not deliver, so
    // a 4xx or a non-JSON body reaching the browser usually means the version has no usable
    // schema; but a body read can also be cut off client-side, so the copy names the attempt and
    // withholds the retry promise without asserting that nothing exists.
    const retryable = details.reason === 'timeout' || details.reason === 'network';
    const detail = details.message.replace(/\.$/, '');
    return [
      {
        text: retryable
          ? `The link set schema for UNTP v${details.version} could not be loaded, so this check could not determine whether the link set conforms. Details: ${detail}. Resolve or upload the link set again to retry.`
          : `The link set schema for UNTP v${details.version} could not be loaded, so this check could not determine whether the link set conforms. Details: ${detail}. If this keeps happening, report it to the Playground operator and include the schema URL: ${details.schemaUrl}.`,
      },
    ];
  }
  if (details.kind === 'schema-unusable') {
    return [
      {
        text: `The link set schema for UNTP v${
          details.version
        } could not be used, so this check could not determine whether the link set conforms. Report this problem to the Playground operator and include the schema URL: ${
          details.schemaUrl
        }. The schema loader reported: ${details.message.replace(/\.$/, '')}.`,
      },
    ];
  }
  return details.errors.map((error: ErrorObject) =>
    isRelationRejection(error, decoded)
      ? {
          text: `${formatValidationError(error)}. The published UNTP v${
            details.version
          } schema rejects the relation "${String(
            error.params?.additionalProperty,
          )}": relation keys must be a lowercase name (letters and hyphens, not starting with "anchor", "description" or "itemDescription") or an http(s) URL made of letters, digits, "." and "/". This is a known restriction of the published schema. This error concerns the relation name only.`,
          relationRule: true,
        }
      : { text: formatValidationError(error) },
  );
}
