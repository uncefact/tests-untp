import { validateAgainstSchemas, validateJsonLd } from '@uncefact/untp-utils/validation';
import { ValidationError } from '@/lib/api/validation';

export async function validateCredentialPayload(credentialPayload: unknown, schemaUrls: string[]): Promise<void> {
  const schemaOutcome = await validateAgainstSchemas(credentialPayload, schemaUrls);
  if (schemaOutcome.errors.length > 0) {
    const summary = schemaOutcome.errors.map((e) => e.message).join('; ');
    throw new ValidationError(`Schema validation failed: ${summary}`);
  }

  const jsonldOutcome = await validateJsonLd(credentialPayload);
  if (jsonldOutcome.errors.length > 0) {
    const summary = jsonldOutcome.errors.map((e) => e.message).join('; ');
    throw new ValidationError(`JSON-LD validation failed: ${summary}`);
  }
}
