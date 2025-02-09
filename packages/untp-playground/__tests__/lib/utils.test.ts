import { detectVcdmVersion } from '@/lib/utils';
import { VCDM_CONTEXT_URLS, VCDMVersion } from '../../constants';

describe('utils', () => {
  describe('detectVcdmVersion', () => {
    it('should detect VCDM v1 version', () => {
      const credential = {
        '@context': [VCDM_CONTEXT_URLS.v1],
      };

      const result = detectVcdmVersion(credential);
      expect(result).toBe(VCDMVersion.V1);
    });

    it('should detect VCDM v2 version', () => {
      const credential = {
        '@context': [VCDM_CONTEXT_URLS.v2],
      };

      const result = detectVcdmVersion(credential);
      expect(result).toBe(VCDMVersion.V2);
    });

    it('should return UNKNOWN for null credential', () => {
      const result = detectVcdmVersion(null as any);
      expect(result).toBe(VCDMVersion.UNKNOWN);
    });

    it('should return UNKNOWN for undefined credential', () => {
      const result = detectVcdmVersion(undefined as any);
      expect(result).toBe(VCDMVersion.UNKNOWN);
    });

    it('should return UNKNOWN when @context is missing', () => {
      const credential = {
        type: ['VerifiableCredential'],
      };

      const result = detectVcdmVersion(credential);
      expect(result).toBe(VCDMVersion.UNKNOWN);
    });

    it('should return UNKNOWN when @context is not an array', () => {
      const credential = {
        '@context': 'https://www.w3.org/2018/credentials/v1',
      };

      const result = detectVcdmVersion(credential);
      expect(result).toBe(VCDMVersion.UNKNOWN);
    });

    it('should return UNKNOWN when @context array is empty', () => {
      const credential = {
        '@context': [],
      };

      const result = detectVcdmVersion(credential);
      expect(result).toBe(VCDMVersion.UNKNOWN);
    });

    it('should return UNKNOWN for unrecognized context URL', () => {
      const credential = {
        '@context': ['https://unknown.context.url'],
      };

      const result = detectVcdmVersion(credential);
      expect(result).toBe(VCDMVersion.UNKNOWN);
    });

    it('should detect version based on first context URL only', () => {
      const credential = {
        '@context': [
          VCDM_CONTEXT_URLS.v1,
          'https://w3id.org/security/suites/jws-2020/v1',
          VCDM_CONTEXT_URLS.v2, // This should be ignored
        ],
      };

      const result = detectVcdmVersion(credential);
      expect(result).toBe(VCDMVersion.V1);
    });
  });
});
