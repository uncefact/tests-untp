import { ValidationError } from '@/lib/api/validation';

/** Reclassifies route body/header validation under the API's stable 400 code. */
export function rethrowAsValidationFailed(error: unknown): never {
  if (error instanceof ValidationError) {
    throw new ValidationError(error.message, { code: 'VALIDATION_FAILED', cause: error });
  }
  throw error;
}
