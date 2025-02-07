import { validateVcAgainstSchema } from '@/lib/schemaValidation';
import { detectVcdmVersion } from '@/lib/utils';
import { validateVcdmRules } from '@/lib/vcdm-validation/vcdmValidation';
import { VCDM_CONTEXT_URLS, VCDMVersion } from '../../../constants';

jest.mock('@/lib/schemaValidation');
jest.mock('@/lib/utils');

describe('vcdmValidation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateVcdmRules', () => {
    it('should validate a valid credential', async () => {
      const validCredential = {
        '@context': [VCDM_CONTEXT_URLS[VCDMVersion.V2], 'https://w3id.org/security/suites/jws-2020/v1'],
        type: ['VerifiableCredential'],
        issuer: 'did:example:123',
      };

      (detectVcdmVersion as jest.Mock).mockReturnValue(VCDMVersion.V2);
      (validateVcAgainstSchema as jest.Mock).mockResolvedValue({
        valid: true,
        errors: [],
      });

      const result = await validateVcdmRules(validCredential);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should fail when @context is missing with all applicable errors', async () => {
      const invalidCredential = {
        type: ['VerifiableCredential'],
        issuer: 'did:example:123',
      };

      const result = await validateVcdmRules(invalidCredential);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(4);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          {
            keyword: 'required',
            instancePath: '@context',
            message: 'The "@context" property is required.',
            params: { missingProperty: '@context' },
          },
          {
            keyword: 'type',
            instancePath: '@context',
            message: 'The "@context" property must be an array.',
            params: { type: 'array' },
          },
          {
            keyword: 'minItems',
            instancePath: '@context',
            message: 'The "@context" array must contain at least one item.',
            params: { minItems: 1 },
          },
          {
            keyword: 'missingValue',
            instancePath: '@context[0]',
            message: 'The first element of "@context" must be one of the following:',
            params: { allowedValues: Object.values(VCDM_CONTEXT_URLS) },
          },
        ]),
      );
    });

    it('should fail when @context is not an array with all applicable errors', async () => {
      const invalidCredential = {
        '@context': 'https://www.w3.org/2018/credentials/v1',
        type: ['VerifiableCredential'],
        issuer: 'did:example:123',
      };

      const result = await validateVcdmRules(invalidCredential);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(3);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          {
            keyword: 'type',
            instancePath: '@context',
            message: 'The "@context" property must be an array.',
            params: { type: 'array' },
          },
          {
            keyword: 'minItems',
            instancePath: '@context',
            message: 'The "@context" array must contain at least one item.',
            params: { minItems: 1 },
          },
          {
            keyword: 'missingValue',
            instancePath: '@context[0]',
            message: 'The first element of "@context" must be one of the following:',
            params: { allowedValues: Object.values(VCDM_CONTEXT_URLS) },
          },
        ]),
      );
    });

    it('should fail when @context array is empty with all applicable errors', async () => {
      const invalidCredential = {
        '@context': [],
        type: ['VerifiableCredential'],
        issuer: 'did:example:123',
      };

      const result = await validateVcdmRules(invalidCredential);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          {
            keyword: 'minItems',
            instancePath: '@context',
            message: 'The "@context" array must contain at least one item.',
            params: { minItems: 1 },
          },
          {
            keyword: 'missingValue',
            instancePath: '@context[0]',
            message: 'The first element of "@context" must be one of the following:',
            params: { allowedValues: Object.values(VCDM_CONTEXT_URLS) },
          },
        ]),
      );
    });

    it('should fail when first @context value is not a valid VCDM version', async () => {
      const invalidCredential = {
        '@context': ['https://invalid.context.url'],
        type: ['VerifiableCredential'],
        issuer: 'did:example:123',
      };

      (detectVcdmVersion as jest.Mock).mockReturnValue(VCDMVersion.UNKNOWN);

      const result = await validateVcdmRules(invalidCredential);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        keyword: 'missingValue',
        instancePath: '@context[0]',
        message: 'The first element of "@context" must be one of the following:',
        params: { allowedValues: Object.values(VCDM_CONTEXT_URLS) },
      });
    });

    it('should combine errors from context validation and schema validation', async () => {
      const invalidCredential = {
        '@context': [VCDM_CONTEXT_URLS[VCDMVersion.V2]],
        // missing issuer
        type: ['VerifiableCredential'],
      };

      (detectVcdmVersion as jest.Mock).mockReturnValue(VCDMVersion.V2);
      (validateVcAgainstSchema as jest.Mock).mockResolvedValue({
        valid: false,
        errors: [
          {
            keyword: 'required',
            instancePath: '',
            message: "must have required property 'issuer'",
            params: { missingProperty: 'issuer' },
          },
        ],
      });

      const result = await validateVcdmRules(invalidCredential);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        keyword: 'required',
        message: "must have required property 'issuer'",
      });
    });

    it('should handle schema validation errors', async () => {
      const credential = {
        '@context': [VCDM_CONTEXT_URLS[VCDMVersion.V2]],
        type: ['VerifiableCredential'],
        issuer: 123, // invalid type for issuer
      };

      (detectVcdmVersion as jest.Mock).mockReturnValue(VCDMVersion.V2);
      (validateVcAgainstSchema as jest.Mock).mockResolvedValue({
        valid: false,
        errors: [
          {
            keyword: 'type',
            instancePath: '/issuer',
            message: 'must be string',
            params: { type: 'string' },
          },
        ],
      });

      const result = await validateVcdmRules(credential);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        keyword: 'type',
        instancePath: '/issuer',
        message: 'must be string',
      });
    });
  });
});
