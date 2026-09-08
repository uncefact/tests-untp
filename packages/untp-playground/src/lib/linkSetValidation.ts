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
 * The published schema is draft-07. The credential and scheme validators compile with Ajv2020,
 * which refuses a draft-07 `$schema` outright, so this module keeps its own draft-07 instances.
 * One instance per schema document, because the published `$id` is not version-qualified and Ajv
 * refuses a second distinct document under an `$id` it already holds.
 */

import { buildLinkSetSchemaUrl } from '@uncefact/untp-utils/artefacts';
import type { ErrorObject } from 'ajv';
import Ajv from 'ajv';
import type { TestStep } from '@/types';
import { TestCaseStatus, TestCaseStepId } from '../../constants';
import { formatValidationError, pointerSegments } from './formatValidationErrors';
import { fetchSchema, SchemaFetchError, type SchemaFetchReason } from './schemaFetch';

export { buildLinkSetSchemaUrl as linkSetSchemaUrl };

/** A validation attempt. `version` and `schemaUrl` are recorded on every outcome, including failures to assess. */
export type LinkSetSchemaResult =
  | { kind: 'document'; valid: boolean; errors: ErrorObject[]; version: string; schemaUrl: string }
  | { kind: 'schema-unavailable'; reason: SchemaFetchReason; message: string; version: string; schemaUrl: string }
  | { kind: 'schema-unusable'; message: string; version: string; schemaUrl: string };

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
    | Partial<Record<'kind' | 'version' | 'schemaUrl' | 'errors' | 'reason' | 'message', unknown>>
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

// Compiled validators keyed by the schema object the transport cached, never by `$id`.
const validators = new WeakMap<object, ReturnType<Ajv['compile']>>();

function compile(schema: object) {
  const cached = validators.get(schema);
  if (cached) return cached;
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false, verbose: true });
  const validate = ajv.compile(schema);
  validators.set(schema, validate);
  return validate;
}

export async function validateLinkSetSchema(document: unknown, version: string): Promise<LinkSetSchemaResult> {
  const schemaUrl = buildLinkSetSchemaUrl(version);

  let schema: unknown;
  try {
    schema = await fetchSchema(schemaUrl);
  } catch (err) {
    if (err instanceof SchemaFetchError) {
      return { kind: 'schema-unavailable', reason: err.reason, message: err.message, version, schemaUrl };
    }
    throw err;
  }

  let validate: ReturnType<typeof compile>;
  try {
    if (typeof schema !== 'object' || schema === null) throw new Error('Schema is not a JSON object.');
    validate = compile(schema);
  } catch (err) {
    console.error('linkSetValidation: schema could not be compiled', { schemaUrl, err });
    return {
      kind: 'schema-unusable',
      message: err instanceof Error ? err.message : 'Schema could not be compiled.',
      version,
      schemaUrl,
    };
  }

  const valid = validate(document) === true;
  return { kind: 'document', valid, errors: valid ? [] : [...(validate.errors ?? [])], version, schemaUrl };
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
