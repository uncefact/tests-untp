import {
  validateAgainstSchemas,
  validateJsonLd,
  SchemaPayloadError,
  SchemaValidationError,
  JsonLdValidationError,
} from '@uncefact/untp-utils/validation';
import type { SchemaLoader } from '@uncefact/untp-utils/loaders';
import { ValidationError } from '@/lib/api/validation';
import { contextCache } from './context-cache';

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
      throw new ValidationError(`Schema validation failed: ${summary}`);
    }
    if (e instanceof SchemaValidationError) {
      throw new ValidationError(`Schema validation failed: ${e.message}`);
    }
    throw e;
  }

  try {
    await validateJsonLd(credentialPayload, { contextCache });
  } catch (e) {
    if (e instanceof JsonLdValidationError) {
      throw new ValidationError(`JSON-LD validation failed: ${e.message}`);
    }
    throw e;
  }
}
