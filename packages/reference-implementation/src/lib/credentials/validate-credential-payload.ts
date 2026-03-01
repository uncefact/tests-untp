import { validateAgainstSchemas, validateJsonLd } from '@uncefact/untp-ri-services';
import { ValidationError } from '@/lib/api/validation';

export async function validateCredentialPayload(credentialPayload: unknown, schemaUrls: string[]): Promise<void> {
  try {
    await validateAgainstSchemas(credentialPayload, schemaUrls);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Schema validation failed';
    throw new ValidationError(message);
  }

  try {
    await validateJsonLd(credentialPayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'JSON-LD validation failed';
    throw new ValidationError(message);
  }
}
