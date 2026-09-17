import type { IVerifiableCredentialService } from '@uncefact/untp-ri-services';

/**
 * Builds the verifier double shared by integration suites. The status methods
 * fail loudly if a test accidentally starts exercising an unconfigured path.
 */
export function createVerifierDouble(
  verify: IVerifiableCredentialService['verify'] = jest.fn() as IVerifiableCredentialService['verify'],
): IVerifiableCredentialService {
  return {
    sign: jest.fn(),
    verify,
    setCredentialStatus: jest.fn().mockImplementation(async () => {
      throw new Error('not used in this test');
    }),
    getCredentialStatus: jest.fn().mockImplementation(async () => {
      throw new Error('not used in this test');
    }),
  };
}
