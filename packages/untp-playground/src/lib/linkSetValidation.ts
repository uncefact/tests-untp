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
 * Narrows a step's untyped `details` back to the shape this module wrote. One accessor here means
 * the card today and the report (#814) later read the same contract instead of each casting.
 */
export function linkSetSchemaStepDetails(step: TestStep): LinkSetSchemaStepDetails | undefined {
  const details = step.details as { kind?: unknown } | undefined;
  if (details?.kind === 'document' || details?.kind === 'schema-unavailable' || details?.kind === 'schema-unusable') {
    return details as LinkSetSchemaStepDetails;
  }
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
