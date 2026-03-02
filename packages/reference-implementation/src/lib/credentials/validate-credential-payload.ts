import {
  validateAgainstSchemas,
  validateJsonLd,
  SchemaValidationError,
  JsonLdValidationError,
} from '@uncefact/untp-ri-services';
import { ValidationError } from '@/lib/api/validation';

export async function validateCredentialPayload(credentialPayload: unknown, schemaUrls: string[]): Promise<void> {
  try {
    await validateAgainstSchemas(credentialPayload, schemaUrls);
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      throw new ValidationError(error.message);
    }
    throw error;
  }

  try {
    await validateJsonLd(credentialPayload);
  } catch (error) {
    if (error instanceof JsonLdValidationError) {
      throw new ValidationError(error.message);
    }
    throw error;
  }
}
