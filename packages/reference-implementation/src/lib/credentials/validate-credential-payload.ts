import {
  validateAgainstSchemas,
  validateJsonLd,
  describeJsonLdFailure,
  SchemaPayloadError,
  SchemaValidationError,
  JsonLdValidationError,
} from '@uncefact/untp-utils/validation';
import type { SchemaLoader } from '@uncefact/untp-utils/loaders';
import { ValidationError } from '@/lib/api/validation';
import { contextCache } from './context-cache';
import { bundledArtefactsFallback } from './schema-loader';

export async function validateCredentialPayload(
  credentialPayload: unknown,
  schemaUrls: string[],
  loader: SchemaLoader,
): Promise<void> {
  try {
    await validateAgainstSchemas(credentialPayload, schemaUrls, loader);
  } catch (e) {
    if (e instanceof SchemaPayloadError) {
      const summary = e.failures.map((f) => f.message).join('; ');
      throw new ValidationError(`Schema validation failed: ${summary}`, { code: 'SCHEMA_DOCUMENT_INVALID', cause: e });
    }
    if (e instanceof SchemaValidationError) {
      // Fetch and compilation failures alike: the schema could not be used,
      // which is an upstream or configuration condition, not a payload fault.
      throw new ValidationError(`Schema validation failed: ${e.message}`, { code: 'SCHEMA_FETCH_FAILED', cause: e });
    }
    throw e;
  }

  try {
    await validateJsonLd(credentialPayload, { contextCache, ...bundledArtefactsFallback });
  } catch (e) {
    if (e instanceof JsonLdValidationError) {
      // Two caller-facing classes (the 400's `code` distinguishes them): a
      // document problem carries the processor's detail so the caller knows
      // what to fix; a context problem (could not be fetched, or fetched but
      // not usable as a context) names the URL and condition in the typed
      // diagnostic's terms. Either way the full cause chain rides on the
      // ValidationError for the server-side log.
      const failure = describeJsonLdFailure(e);
      const code = failure.kind === 'document' ? 'JSONLD_DOCUMENT_INVALID' : 'JSONLD_CONTEXT_FETCH_FAILED';
      throw new ValidationError(`JSON-LD validation failed: ${failure.detail}`, { code, cause: e });
    }
    throw e;
  }
}
