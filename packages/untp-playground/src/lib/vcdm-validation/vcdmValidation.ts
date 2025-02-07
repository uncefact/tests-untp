import { validateWithRules } from '@/lib/validationHelpers';
import { permittedVcdmContextUrls, permittedVcdmVersions } from '../../../constants';
import { validateVerifiableCredentialAgainstSchema } from '../schemaValidation';
import { detectVcdmVersion } from '../utils';
import { vcdmContextRules } from './rules';

/**
 * Validates a VerifiableCredential against the VCDM rules.
 * @param credential - The VerifiableCredential to validate.
 * @returns A Promise that resolves to an object containing the validation result.
 */
export async function validateVcdmRules(credential: any) {
  // Validate the @context property so that we can narrow the case of possible errors.
  const contextErrors = await validateWithRules(credential['@context'], vcdmContextRules);

  if (contextErrors.length > 0) {
    return {
      valid: false,
      errors: contextErrors,
    };
  }

  const version = detectVcdmVersion(credential);

  if (!permittedVcdmVersions.includes(version)) {
    return {
      valid: false,
      errors: [
        {
          keyword: 'missingValue',
          instancePath: '@context[0]',
          message: `The first element of "@context" must be one of the following:`,
          params: { allowedValues: permittedVcdmContextUrls },
        },
      ],
    };
  }

  const { errors } = (await validateVerifiableCredentialAgainstSchema(credential, version)) || { errors: [] };

  const allErrors = [...contextErrors, ...errors];
  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}
