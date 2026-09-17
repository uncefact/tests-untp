import { validateWithRules } from '@/lib/validationHelpers';
import { permittedVcdmContextUrls, permittedVcdmVersions, VCDMVersion } from '../../../constants';
import { validateVcAgainstSchema } from '../schemaValidation';
import { detectVcdmVersion } from '../utils';
import { vcdmContextRules } from './rules';
import { classifySchemaPayloadFailure } from '../artefactFailure';

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
      failure: classifySchemaPayloadFailure('The credential failed the VCDM context rules.', 'vcdm'),
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
      failure: classifySchemaPayloadFailure(
        `The credential declares VCDM version "${version}", which this Playground does not validate.`,
        'vcdm',
        { remediation: 'Correct the VCDM @context version in the credential.' },
      ),
    };
  }

  const schemaResult = await validateVcAgainstSchema(credential, version as VCDMVersion.V2);
  const errors = schemaResult.errors ?? [];

  const allErrors = [...contextErrors, ...errors];
  return {
    valid: allErrors.length === 0 && !schemaResult.failure,
    errors: allErrors,
    failure:
      schemaResult.failure ??
      (allErrors.length > 0
        ? classifySchemaPayloadFailure('The credential failed VCDM validation.', 'vcdm')
        : undefined),
  };
}
