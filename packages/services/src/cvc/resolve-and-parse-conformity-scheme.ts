import { TextDecoder } from 'node:util';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import { resolveDocumentIfChanged } from '@uncefact/untp-utils/resolvers';
import { validateAgainstSchemas, validateJsonLd } from '@uncefact/untp-utils/validation';
import { parseConformityScheme } from '@uncefact/untp-utils/conformity-vocabulary';
import { ConformitySchemeResolveError } from './errors.js';
import {
  RESOLVE_FAILURE_STATUS,
  type ResolveAndParseConformitySchemeInput,
  type ResolveAndParseConformitySchemeResult,
  type ResolveFailureStatus,
} from './types.js';

/**
 * Composes the five CVC pipeline gates (fetch, JSON parse, JSON Schema
 * validation, JSON-LD expansion, parse) plus the body-digest step into a
 * single best-effort flow. Schema validation runs before JSON-LD expansion
 * because it's cheaper to fail: Ajv compile + check is local CPU, while
 * JSON-LD expansion may fetch remote `@context` documents and walks the full
 * RDF tree. Failing fast on schema-shape problems avoids paying the JSON-LD
 * cost on documents that wouldn't have parsed anyway.
 *
 * Three terminal outcomes:
 * `{ kind: 'unchanged' }`, the conditional-fetch skip chain hit; bump
 *   `lastFetchedAt` only, retain previous content.
 * `{ kind: 'success', scheme, raw, bodyDigest, etag?, lastModifiedHeader? }`,
 *   full upsert of the scheme + profiles + criteria + cache validators.
 * `{ kind: 'failure', error }`, a gate failed. Caller persists
 *   `lastFetchStatus = error.status` and retains previous content.
 *
 * The function never throws for known gate failures; every failure path
 * surfaces as `{ kind: 'failure', error }`.
 *
 * @see ADR-033 §1 (Discovery and refresh; Validation at ingest).
 */
export async function resolveAndParseConformityScheme(
  input: ResolveAndParseConformitySchemeInput,
): Promise<ResolveAndParseConformitySchemeResult> {
  let body: Uint8Array;
  let etag: string | undefined;
  let lastModifiedHeader: string | undefined;

  if (input.prefetched) {
    body = input.prefetched.body;
    etag = input.prefetched.etag;
    lastModifiedHeader = input.prefetched.lastModifiedHeader;
  } else {
    try {
      const outcome = await resolveDocumentIfChanged(input.sourceUrl, input.cached ?? {});
      if (outcome.kind === 'unchanged') return { kind: 'unchanged' };
      body = outcome.result.body;
      etag = outcome.result.etag;
      lastModifiedHeader = outcome.result.lastModified;
    } catch (cause) {
      return failure(RESOLVE_FAILURE_STATUS.FetchFailed, input.sourceUrl, cause);
    }
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(new TextDecoder().decode(body));
  } catch (cause) {
    return failure(RESOLVE_FAILURE_STATUS.InvalidJson, input.sourceUrl, cause);
  }

  try {
    await validateAgainstSchemas(parsedJson, [input.conformitySchemaUrl], input.schemaLoader);
  } catch (cause) {
    return failure(RESOLVE_FAILURE_STATUS.SchemaInvalid, input.sourceUrl, cause);
  }

  try {
    await validateJsonLd(parsedJson);
  } catch (cause) {
    return failure(RESOLVE_FAILURE_STATUS.JsonLdExpansionFailed, input.sourceUrl, cause);
  }

  let scheme;
  try {
    scheme = parseConformityScheme(parsedJson, {
      sourceUrl: input.sourceUrl,
      specVersion: input.cvcSpecVersion,
    });
  } catch (cause) {
    return failure(RESOLVE_FAILURE_STATUS.ParseFailed, input.sourceUrl, cause);
  }

  let bodyDigest: MultibaseDigest;
  try {
    bodyDigest = await MultibaseDigest.fromData(body, { algorithm: 'sha2-256', base: 'base58btc' });
  } catch (cause) {
    return failure(RESOLVE_FAILURE_STATUS.DigestFailed, input.sourceUrl, cause);
  }

  return {
    kind: 'success',
    scheme,
    raw: parsedJson,
    bodyDigest,
    ...(etag !== undefined ? { etag } : {}),
    ...(lastModifiedHeader !== undefined ? { lastModifiedHeader } : {}),
  };
}

function failure(
  status: ResolveFailureStatus,
  sourceUrl: string,
  cause: unknown,
): ResolveAndParseConformitySchemeResult {
  return {
    kind: 'failure',
    error: new ConformitySchemeResolveError({ status, sourceUrl, cause }),
  };
}
